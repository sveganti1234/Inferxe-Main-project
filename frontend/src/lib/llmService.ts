/**
 * llmService.ts
 * ==============
 * Service client connecting the Inferxe Chatbot to the fine-tuned model via Ollama.
 * 
 * Features:
 * - Active Model: "inferxe-qwen-ft" (fine-tuned model)
 * - Rollback Model: "inferxe-assistant" (original model)
 * - Strict domain boundary & intent gatekeeper
 * - Graceful fallback to deterministic local engine if Ollama is unreachable
 * - Zero exposure of internal paths or credentials
 */

import { getSession, getCognitoTokenFromStorage } from './authStore'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmConfig {
  activeModel: string
  fallbackModel: string
  endpoint: string
  timeoutMs: number
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  activeModel: 'inferxe-qwen-ft',
  fallbackModel: 'inferxe-assistant',
  endpoint: 'http://127.0.0.1:11434/api/chat',
  timeoutMs: 1200,
}

export const INFERXE_SYSTEM_PROMPT = `You are the Inferxe GPU infrastructure assistant. Answer only approved GPU, LLM inference, cloud pricing, and documented Inferxe platform questions. Never invent facts.

STRICT SCOPE AND LIMITATION POLICY:
1. DOMAIN BOUNDARY: You MUST ONLY answer questions concerning:
   - GPU hardware specifications (NVIDIA H100, H200, L40S, L4, A100, A30, RTX Pro 6000 Blackwell, B200)
   - LLM workload memory sizing (weights, KV-cache, context windows, concurrency)
   - GPU cloud pricing and providers (JarvisLabs.ai live rates in INR/USD, E2E Networks, Yotta, spot instances)
   - Serving engines and benchmarks (vLLM, continuous batching, TTFT, cost per million tokens)
   - Inferxe website features, simulated wallet, and documented architecture.

2. MANDATORY REFUSAL FOR OUT-OF-SCOPE QUESTIONS:
   If the user asks ANY question outside GPU infrastructure, hardware, cloud pricing, or Inferxe website documentation (e.g. general coding, recipes, weather, politics, jokes, non-GPU advice), you MUST refuse to answer and respond ONLY with:
   "I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I cannot assist with topics outside this scope."

3. UNGROUNDED / MISSING INFORMATION REFUSAL:
   If the user asks a relevant question where verified documentation is missing or not provided, you MUST respond ONLY with:
   "I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I couldn't find verified information about that in the available documentation, so I don't want to guess."

4. ACCURACY AND HONESTY: Never invent prices or specifications. Keep responses concise, objective, fact-driven, and professional.`

export const OUT_OF_SCOPE_REFUSAL =
  'I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I cannot assist with topics outside this scope.'

export const INSUFFICIENT_INFO_REFUSAL =
  "I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I couldn't find verified information about that in the available documentation, so I don't want to guess."

/**
 * Validates whether the user query is strictly within the allowed GPU and Inferxe domains.
 */
export function checkDomainGatekeeper(query: string): 'allowed' | 'out_of_scope' | 'greeting' {
  const q = query.toLowerCase().trim()

  // 1. Casual Chat & Greetings
  if (
    /^(h+i+|h+e+y+|h+e+l+l+o+|greetings|howdy|sup|good\s+(morning|afternoon|evening)|namaste)(!|\.|\?|\s)*$/i.test(q) ||
    /\b(how are you|how is it going|who are you|what can you do|what is your name|can you help|help me|need help|assist me)\b/i.test(q) ||
    /^(help|hello|hi|hey|test)[\s?!.]*$/i.test(q)
  ) {
    return 'greeting'
  }

  // 2. Explicit Out-of-Scope Triggers (strict non-tech/non-computing topics)
  if (
    /\b(bake|cake|recipe|cook|cooking|weather|chocolate|pasta|pizza|dinner|sports|cricket|football|movie|song|poem|joke|politician|president|minister|election|history|biology|chemistry|calculus|medical|doctor|sore throat|fever)\b/i.test(q) ||
    /\b(write (a|an|me|some)?\s*(unrelated|python script about cooking|poem|joke))\b/i.test(q)
  ) {
    return 'out_of_scope'
  }

  // 3. Allowed Domain Whitelist
  const isGpuOrPlatform =
    /\b(gpu|gpus|nvidia|h100|h200|l40s|l40|l4|a100|a30|a6000|b200|rtx|blackwell|hopper|ada|ampere|vram|memory|bandwidth|tensor|cuda|tflops|tops|tdp|nvlink|pcie|sxm)\b/i.test(q) ||
    /\b(llama|qwen|mistral|mixtral|gemma|deepseek|model|models|weights|kv\s*cache|context|vllm|docker|token|tokens|prompt|completion|quantization|quantized|awq|gptq|fp8|fp16|bf16|throughput|latency|ttft)\b/i.test(q) ||
    /\b(jarvislabs|jarvis|e2e|yotta|cyfuture|runpod|lambda|vast|aws|azure|gcp|price|pricing|rate|rates|cost|hourly|spot|on-demand|inr|usd|rupee|₹|\$|bill|billing|quota|payment|payments|pay|topup|top-up|upi|card|cards|money|funds?|credits?|deposit|balance|burn|burn\s*rate)\b/i.test(q) ||
    /\b(inferxe|platform|website|site|web\s*page|company|about|service|services|feature|features|marketplace|catalog|catalogue|dashboard|workspace|portal|kanban|board|tasks?|todo|deploy|deployment|instance|instances|reservation|reserve|rent|rental|order|sovereign|india|noida|mumbai|dpdp|compliance|residency|api|sdk|key|auth|login|signup|register|sign-in|sign-up|account|contact|support|solutions?|roadmap|legal|terms|security|team)\b/i.test(q) ||
    /\b(sizing|calculate|calculator|recommend|recommendation|spec|specs|specification|benchmark|benchmarks|how\s+to|how\s+it\s+works|what\s+does\s+this|tell\s+me\s+about|what\s+is|explain|overview|sahith|project|work|done|answer|questions?|chat|chatbot|assistant)\b/i.test(q)

  return isGpuOrPlatform ? 'allowed' : 'out_of_scope'
}

/**
 * Source citation metadata returned by the RAG backend.
 */
export interface SourceReference {
  title: string
  link?: string
  snippet?: string
}

export const RAG_BACKEND_ENDPOINT = 'http://127.0.0.1:8000/api/chat'

/**
 * Queries the FastAPI RAG pipeline backed by ChromaDB vector search and local dataset grounding.
 */
export async function queryFineTunedModel(
  userQuery: string,
  history: ChatMessage[] = [],
  context: { userRole?: string; currentPath?: string; sessionId?: string } = {}
): Promise<{ text: string; modelUsed: string; isFallback: boolean; sources?: SourceReference[] }> {
  // 1. Enforce Domain Gatekeeper (Fast pre-check)
  const domainStatus = checkDomainGatekeeper(userQuery)
  if (domainStatus === 'out_of_scope') {
    return {
      text: OUT_OF_SCOPE_REFUSAL,
      modelUsed: 'domain-guardrail-gatekeeper',
      isFallback: false,
    }
  }

  // 2. Primary RAG Pipeline Call to FastAPI Backend
  try {
    const ragController = new AbortController()
    const ragTimeout = setTimeout(() => ragController.abort(), 15000)

    const token = getCognitoTokenFromStorage() || getSession()?.token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const ragResponse = await fetch(RAG_BACKEND_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: userQuery,
        conversation_history: history.slice(-4),
        temperature: 0.2,
        user_role: context.userRole || 'guest',
        current_path: context.currentPath || '/',
        ...(context.sessionId ? { session_id: context.sessionId } : {}),
      }),
      signal: ragController.signal,
    })

    clearTimeout(ragTimeout)

    if (ragResponse.ok) {
      const ragData = await ragResponse.json()
      if (ragData && ragData.response) {
        const mappedSources: SourceReference[] = (ragData.sources || []).map((s: any) => ({
          title: `📁 ${s.source_file || 'Verified Dataset'} (${s.doc_type || s.category})`,
          link: '#',
          snippet: `Category: ${s.category} | Pricing Type: ${s.pricing_type}`,
        }))

        return {
          text: ragData.response,
          modelUsed: 'inferxe-rag-chroma',
          isFallback: false,
          sources: mappedSources.length > 0 ? mappedSources : undefined,
        }
      }
    }
  } catch {
    // If RAG service is unreachable, proceed to direct fallback
  }

  // 3. Fallback Direct Ollama API Call if FastAPI service is temporarily offline
  const messagesPayload: ChatMessage[] = [
    { role: 'system', content: INFERXE_SYSTEM_PROMPT },
    ...history.slice(-4),
    { role: 'user', content: userQuery },
  ]

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_LLM_CONFIG.timeoutMs)

    const response = await fetch(DEFAULT_LLM_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_LLM_CONFIG.activeModel,
        messages: messagesPayload,
        stream: false,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_predict: 250,
        },
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()
      const content = data?.message?.content
      if (content && typeof content === 'string' && content.trim().length > 0) {
        return {
          text: content.trim(),
          modelUsed: DEFAULT_LLM_CONFIG.activeModel,
          isFallback: false,
        }
      }
    }
  } catch {
    // If Ollama is also unreachable, fallback to deterministic local reply
  }

  return {
    text: '',
    modelUsed: 'local-fallback',
    isFallback: true,
  }
}
