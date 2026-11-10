"""
Supervised Fine-Tuning (SFT) script using Hugging Face Transformers and PEFT (LoRA).
Fine-tunes Qwen2.5-0.5B-Instruct on the prepared Inferxe dataset.
"""

import os
import sys
import json
import time
import math
import torch
from dataclasses import dataclass, asdict
from typing import Dict, List, Any

# Enforce UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

@dataclass
class TrainingConfig:
    base_model_name_or_path: str = "Qwen/Qwen2.5-0.5B-Instruct"
    train_data_path: str = "finetuning/data/train.jsonl"
    val_data_path: str = "finetuning/data/validation.jsonl"
    output_dir: str = "finetuning/output/inferxe-qwen-ft-adapter"
    metrics_output_path: str = "finetuning/results/training_metrics.json"
    config_output_path: str = "finetuning/configs/training_config.json"
    
    # LoRA Parameters
    lora_r: int = 8
    lora_alpha: int = 16
    lora_dropout: float = 0.05
    target_modules: List[str] = None
    
    # Optimization Hyperparameters
    num_train_epochs: int = 3
    per_device_train_batch_size: int = 2
    per_device_eval_batch_size: int = 2
    gradient_accumulation_steps: int = 2
    learning_rate: float = 2e-4
    weight_decay: float = 0.01
    warmup_ratio: float = 0.1
    max_seq_length: int = 512
    seed: int = 42

    def __post_init__(self):
        if self.target_modules is None:
            self.target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]

def load_jsonl_messages(filepath: str) -> List[Dict[str, Any]]:
    records = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records

def format_chatml(messages: List[Dict[str, str]], tokenizer) -> str:
    # Use tokenizer's chat template if available, else format standard ChatML
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    
    # Standard Qwen ChatML fallback
    text = ""
    for m in messages:
        text += f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n"
    return text

def run_fine_tuning(config: TrainingConfig):
    print("=" * 70)
    print("INFERXE AI ASSISTANT â€” SUPERVISED FINE-TUNING (SFT) WITH LoRA")
    print("=" * 70)
    print(f"Base Model:       {config.base_model_name_or_path}")
    print(f"Train Dataset:    {config.train_data_path}")
    print(f"Val Dataset:      {config.val_data_path}")
    print(f"Output Directory: {config.output_dir}")
    print(f"LoRA Config:      r={config.lora_r}, alpha={config.lora_alpha}, dropout={config.lora_dropout}")
    print(f"Target Modules:   {', '.join(config.target_modules)}")
    print(f"Device:           {'CUDA (' + torch.cuda.get_device_name(0) + ')' if torch.cuda.is_available() else 'CPU'}")
    print("=" * 70)

    os.makedirs(os.path.dirname(config.output_dir), exist_ok=True)
    os.makedirs(os.path.dirname(config.metrics_output_path), exist_ok=True)
    os.makedirs(os.path.dirname(config.config_output_path), exist_ok=True)

    # Save training configuration
    with open(config.config_output_path, "w", encoding="utf-8") as f:
        json.dump(asdict(config), f, indent=2)

    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import LoraConfig, get_peft_model, TaskType

    print("\n[Step 1/5] Loading tokenizer and model...")
    tokenizer = AutoTokenizer.from_pretrained(config.base_model_name_or_path, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    torch_dtype = torch.float16 if torch.cuda.is_available() else torch.float32

    model = AutoModelForCausalLM.from_pretrained(
        config.base_model_name_or_path,
        torch_dtype=torch_dtype,
        trust_remote_code=True
    )
    model.to(device)

    print("\n[Step 2/5] Injecting LoRA adapters...")
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=config.lora_r,
        lora_alpha=config.lora_alpha,
        lora_dropout=config.lora_dropout,
        target_modules=config.target_modules,
        bias="none"
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    print("\n[Step 3/5] Tokenizing dataset...")
    train_records = load_jsonl_messages(config.train_data_path)
    val_records = load_jsonl_messages(config.val_data_path)

    print(f"Train samples: {len(train_records)}")
    print(f"Val samples:   {len(val_records)}")

    def tokenize_batch(records):
        inputs = []
        for r in records:
            text = format_chatml(r["messages"], tokenizer)
            enc = tokenizer(
                text,
                truncation=True,
                max_length=config.max_seq_length,
                padding="max_length",
                return_tensors="pt"
            )
            input_ids = enc["input_ids"].squeeze(0)
            attention_mask = enc["attention_mask"].squeeze(0)
            labels = input_ids.clone()
            labels[labels == tokenizer.pad_token_id] = -100
            inputs.append({
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "labels": labels
            })
        return inputs

    train_data = tokenize_batch(train_records)
    val_data = tokenize_batch(val_records)

    # Optimizer and scheduler
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay
    )

    total_steps = (len(train_data) // (config.per_device_train_batch_size * config.gradient_accumulation_steps)) * config.num_train_epochs
    warmup_steps = max(1, int(total_steps * config.warmup_ratio))

    def get_lr(step):
        if step < warmup_steps:
            return config.learning_rate * (step / warmup_steps)
        progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
        return config.learning_rate * 0.5 * (1.0 + math.cos(math.pi * progress))

    print("\n[Step 4/5] Running LoRA training loop...")
    print(f"Total Epochs:          {config.num_train_epochs}")
    print(f"Batch Size per Device: {config.per_device_train_batch_size}")
    print(f"Gradient Accumulation: {config.gradient_accumulation_steps}")
    print(f"Total Steps:           {total_steps}")
    print(f"Warmup Steps:          {warmup_steps}")

    history = {
        "train_loss": [],
        "eval_loss": [],
        "steps": [],
        "epochs": []
    }

    step = 0
    start_time = time.time()
    model.train()

    for epoch in range(1, config.num_train_epochs + 1):
        epoch_loss = 0.0
        batches = [train_data[i:i + config.per_device_train_batch_size] for i in range(0, len(train_data), config.per_device_train_batch_size)]
        
        optimizer.zero_grad()
        for b_idx, batch in enumerate(batches):
            input_ids = torch.stack([x["input_ids"] for x in batch]).to(device)
            attention_mask = torch.stack([x["attention_mask"] for x in batch]).to(device)
            labels = torch.stack([x["labels"] for x in batch]).to(device)

            outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
            loss = outputs.loss / config.gradient_accumulation_steps
            loss.backward()

            epoch_loss += loss.item() * config.gradient_accumulation_steps

            if (b_idx + 1) % config.gradient_accumulation_steps == 0 or (b_idx + 1) == len(batches):
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                lr = get_lr(step)
                for param_group in optimizer.param_groups:
                    param_group["lr"] = lr
                optimizer.step()
                optimizer.zero_grad()
                step += 1

                current_loss = loss.item() * config.gradient_accumulation_steps
                history["train_loss"].append(current_loss)
                history["steps"].append(step)
                print(f"  [Epoch {epoch}/{config.num_train_epochs} | Step {step}/{total_steps}] Train Loss: {current_loss:.4f} | LR: {lr:.6f}")

        # Validation at end of epoch
        model.eval()
        val_loss = 0.0
        val_batches = [val_data[i:i + config.per_device_eval_batch_size] for i in range(0, len(val_data), config.per_device_eval_batch_size)]
        with torch.no_grad():
            for batch in val_batches:
                input_ids = torch.stack([x["input_ids"] for x in batch]).to(device)
                attention_mask = torch.stack([x["attention_mask"] for x in batch]).to(device)
                labels = torch.stack([x["labels"] for x in batch]).to(device)
                outputs = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
                val_loss += outputs.loss.item()
        
        val_loss /= max(1, len(val_batches))
        history["eval_loss"].append(val_loss)
        history["epochs"].append(epoch)
        print(f"--> [Epoch {epoch} Finished] Validation Loss: {val_loss:.4f}")
        model.train()

    elapsed = time.time() - start_time
    print(f"\nTraining completed in {elapsed:.2f} seconds.")

    print("\n[Step 5/5] Saving fine-tuned LoRA adapter...")
    model.save_pretrained(config.output_dir)
    tokenizer.save_pretrained(config.output_dir)
    print(f"LoRA Adapter saved to: {config.output_dir}")

    # Save metrics report
    metrics = {
        "model_name": config.base_model_name_or_path,
        "finetuned_adapter": config.output_dir,
        "training_time_seconds": round(elapsed, 2),
        "final_train_loss": history["train_loss"][-1] if history["train_loss"] else None,
        "final_val_loss": history["eval_loss"][-1] if history["eval_loss"] else None,
        "history": history,
        "hardware_info": {
            "device": str(device),
            "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
            "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2) if torch.cuda.is_available() else 0
        }
    }

    with open(config.metrics_output_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"Metrics saved to: {config.metrics_output_path}")

    print("\nSupervised Fine-Tuning workflow finished successfully!")

if __name__ == "__main__":
    cfg = TrainingConfig()
    run_fine_tuning(cfg)
