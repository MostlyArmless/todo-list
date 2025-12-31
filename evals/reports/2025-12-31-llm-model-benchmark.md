# LLM Model Benchmark Report

**Date:** 2025-12-31
**Author:** Claude Code
**Status:** Accepted

## Context

The todo-list application uses a local Ollama LLM for four use cases:
- Voice input parsing (extracting items and list names from natural language)
- Item categorization (assigning items to shopping categories)
- Recipe parsing (extracting structured data from free-text recipes)
- Pantry matching (matching recipe ingredients to pantry items)

The current model is `gemma3:12b`. We evaluated `qwen2.5:7b` as an alternative that fits within the GTX 1070's 8GB VRAM constraint.

## Decision

**Switch from gemma3:12b to qwen2.5:7b**

## Benchmark Results

### Test Configuration
- **Framework:** promptfoo
- **Test Cases:** 21 total (7 voice, 8 categorization, 3 recipe, 3 pantry)
- **Temperature:** 0.1 (matching production settings)
- **Hardware:** GTX 1070 (8GB VRAM)

### Overall Results

| Metric     | gemma3:12b | qwen2.5:7b | Winner     |
|------------|------------|------------|------------|
| Accuracy   | 100.0%     | 100.0%     | TIE        |
| Avg Latency| 23.2s      | 18.2s      | qwen2.5:7b |

### Results by Category

| Use Case         | gemma3:12b     | qwen2.5:7b     | Latency Improvement |
|------------------|----------------|----------------|---------------------|
| Voice Parsing    | 100% @ 12.9s   | 100% @ 8.6s    | 33% faster          |
| Categorization   | 100% @ 17.2s   | 100% @ 17.9s   | 4% slower           |
| Recipe Parsing   | 100% @ 58.8s   | 100% @ 36.6s   | 38% faster          |
| Pantry Matching  | 100% @ 27.7s   | 100% @ 23.2s   | 16% faster          |

### VRAM Usage
- gemma3:12b: ~7.3GB
- qwen2.5:7b: ~4.7GB

## Rationale

1. **Equal Accuracy:** Both models achieved 100% pass rate on all test cases
2. **Faster Response:** qwen2.5:7b is 22% faster overall, with significant improvements in voice parsing (33%) and recipe parsing (38%)
3. **Lower VRAM:** qwen2.5:7b uses 35% less VRAM, leaving more headroom for other applications
4. **User Experience:** Faster responses improve the voice input workflow which is latency-sensitive

## Consequences

### Positive
- Faster voice input processing (most frequent use case)
- More responsive recipe parsing
- Lower GPU memory pressure

### Negative
- Categorization is marginally slower (4%), but this is negligible in absolute terms (0.7s)

### Risks
- Different model may have edge cases not covered by test suite
- If issues arise, can revert to gemma3:12b by changing config

## Implementation

Update `src/config.py`:
```python
llm_model: str = Field(default="qwen2.5:7b")
```

## Test Artifacts

- Eval configuration: `evals/promptfooconfig.yaml`
- Raw results: `evals/results/eval-results.json`

## Future Work

- Add more edge case tests as issues are discovered
- Benchmark newer models as they become available (e.g., llama3.2, phi-4)
- Consider model-specific prompt optimization if needed
