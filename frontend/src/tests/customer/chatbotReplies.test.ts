import { describe, it, expect } from 'vitest'
import { getBotReply } from '../../components/bot/GlobalBotCompanion'

describe('Chatbot query responses and intent handling', () => {
  it('accurately answers "how ot rent a gpu" (including typo tolerance)', () => {
    const reply = getBotReply('how ot rent a gpu')
    expect(reply).toContain('How to Rent or Reserve a GPU on Inferxe')
    expect(reply).toContain('/dashboard/app/gpus')
    expect(reply).toContain('GPU marketplace')
    expect(reply).not.toBe('Thanks for asking! I can help with Inferxe GPU sizing, the inference API, pricing estimates and the customer console. What model or workload are you planning?')
  })

  it('accurately answers "how to rent a gpu"', () => {
    const reply = getBotReply('how to rent a gpu')
    expect(reply).toContain('How to Rent or Reserve a GPU on Inferxe')
    expect(reply).toContain('/dashboard/app/gpus')
  })

  it('accurately answers "what gpus are avalible in this web site" (with typo)', () => {
    const reply = getBotReply('what gpus are avalible in this web site')
    expect(reply).toContain('GPUs Available on Inferxe')
    expect(reply).toContain('NVIDIA H100')
    expect(reply).toContain('NVIDIA L40S')
    expect(reply).toContain('NVIDIA L4')
    expect(reply).toContain('RTX 4090')
    expect(reply).toContain('/dashboard/app/gpus')
  })

  it('accurately answers "what are the pricing of gpus"', () => {
    const reply = getBotReply('what are the pricing of gpus')
    expect(reply).toContain('Inferxe GPU Pricing & Planning Rates')
    expect(reply).toContain('NVIDIA L4')
    expect(reply).toContain('NVIDIA L40S')
    expect(reply).toContain('NVIDIA H100')
    expect(reply).toContain('RTX 4090')
    expect(reply).not.toBe('Thanks for asking! I can help with Inferxe GPU sizing, the inference API, pricing estimates and the customer console. What model or workload are you planning?')
  })

  it('answers specific GPU specifications for H100, A100, RTX 4090, L4', () => {
    const h100Reply = getBotReply('h100 specs')
    expect(h100Reply).toContain('NVIDIA H100 SXM5')
    expect(h100Reply).toContain('80 GB HBM3')

    const a100Reply = getBotReply('a100 specs')
    expect(a100Reply).toContain('NVIDIA A100')
    expect(a100Reply).toContain('HBM2')

    const rtxReply = getBotReply('4090 specs')
    expect(rtxReply).toContain('RTX 4090')
    expect(rtxReply).toContain('24 GB GDDR6X')

    const l4Reply = getBotReply('nvidia l4 specs')
    expect(l4Reply).toContain('NVIDIA L4')
    expect(l4Reply).toContain('24 GB')
  })

  it('answers GPU comparison queries', () => {
    const comparisonReply = getBotReply('compare h100 and a100')
    expect(comparisonReply).toContain('NVIDIA H100 vs A100')
    expect(comparisonReply).toContain('3.35 TB/s')
    expect(comparisonReply).toContain('2.0 TB/s')
  })

  it('answers model catalog queries', () => {
    const modelsReply = getBotReply('what models are supported')
    expect(modelsReply).toContain('Llama 3.3')
    expect(modelsReply).toContain('Qwen 2.5')
    expect(modelsReply).toContain('DeepSeek-R1')
  })

  it('recommends GPU based on model parameter size', () => {
    const recReply = getBotReply('which gpu for 70b')
    expect(recReply).toContain('70B')
    expect(recReply).toContain('H100')
  })

  it('refuses out of scope queries', () => {
    const cakeReply = getBotReply('how to bake a chocolate cake')
    expect(cakeReply).toContain('I can only answer questions related to GPU infrastructure')
  })
})
