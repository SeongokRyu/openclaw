# Token Optimization Guide

This guide covers strategies to reduce token consumption in OpenClaw, which can significantly lower API costs and improve response times.

## Overview

Token consumption in OpenClaw comes from several sources:

| Source | Typical Size | Impact |
|--------|--------------|--------|
| System Prompt | 15-50KB | High - sent every request |
| Context Files (AGENTS.md, SOUL.md) | 10-15KB | High - included in system prompt |
| Conversation History | Variable | Medium-High - grows over time |
| Tool Definitions | 5-10KB | Medium - 30+ tools with schemas |
| Tool Results | Variable | Medium - file reads, search results |
| Skills | 1-5KB each | Low-Medium - 59 available skills |

## 1. Context Caching (Recommended)

Context caching allows reusing precomputed input tokens, providing up to **90% cost reduction** on cached content.

### Anthropic (Automatic)

When using Anthropic API Key authentication, OpenClaw automatically enables caching:

```json5
{
  agents: {
    defaults: {
      models: {
        "anthropic/claude-opus-4-5": {
          params: { cacheRetention: "long" }  // 1 hour cache
        }
      }
    }
  }
}
```

| cacheRetention | Duration | Use Case |
|----------------|----------|----------|
| `"none"` | No caching | Disable caching |
| `"short"` | 5 minutes | Default for API key auth |
| `"long"` | 1 hour | Long conversation sessions |

### Google Gemini

Gemini 2.0+ models support both implicit and explicit caching:

```json5
{
  agents: {
    defaults: {
      model: { primary: "google/gemini-2.5-flash" },
      models: {
        "google/gemini-2.5-flash": {
          params: { cacheRetention: "short" }  // Auto-applied for Gemini 2.0+
        }
      }
    }
  }
}
```

**Supported Gemini Models:**
- Gemini 2.0 Flash/Pro
- Gemini 2.5 Flash/Pro
- Gemini 3.x models
- Gemini experimental models

### Cache-TTL Context Pruning

For best caching results, enable cache-aware pruning:

```json5
{
  agents: {
    defaults: {
      contextPruning: {
        mode: "cache-ttl",
        ttl: "1h"  // Match your cacheRetention setting
      },
      heartbeat: {
        every: "55m"  // Keep cache warm before TTL expires
      }
    }
  }
}
```

---

## 2. Compact Prompt Mode

Reduces system prompt verbosity while maintaining core functionality.

```json5
{
  agents: {
    defaults: {
      promptMode: "compact"  // Options: "full" | "compact" | "minimal" | "none"
    }
  }
}
```

| Mode | Size | Use Case |
|------|------|----------|
| `"full"` | 100% | Default, all features |
| `"compact"` | ~40-50% | Token optimization with full functionality |
| `"minimal"` | ~20-30% | Subagents, limited features |
| `"none"` | ~5% | Basic identity only |

**What compact mode changes:**
- Shorter tool descriptions
- Truncated context files (max 2000 chars each)
- Condensed safety/heartbeat/silent-reply sections
- Minimal runtime information

---

## 3. Conversation History Management

### History Turn Limits

```json5
{
  channels: {
    telegram: {
      dmHistoryLimit: 10        // Max turns per DM
    },
    discord: {
      dmHistoryLimit: 8
    }
  },
  messages: {
    groupChat: {
      historyLimit: 5           // Group chats need less history
    }
  }
}
```

### Aggressive Compaction

```json5
{
  agents: {
    defaults: {
      compaction: {
        mode: "safeguard",
        reserveTokensFloor: 10000,  // Default: 20000
        maxHistoryShare: 0.3        // Default: 0.5 (30% for history)
      }
    }
  }
}
```

---

## 4. Tool Result Pruning

Large tool results (file reads, search results) consume many tokens:

```json5
{
  agents: {
    defaults: {
      contextPruning: {
        mode: "cache-ttl",
        
        // When to start pruning (ratio of context window used)
        softTrimRatio: 0.2,       // Default: 0.3
        hardClearRatio: 0.35,     // Default: 0.5
        
        // Minimum chars before hard-clearing tool results
        minPrunableToolChars: 30000,  // Default: 50000
        
        // Soft trim: keep head + tail of large results
        softTrim: {
          maxChars: 3000,         // Max chars per tool result
          headChars: 500,         // Keep first N chars
          tailChars: 300          // Keep last N chars
        },
        
        // Hard clear: replace old results with placeholder
        hardClear: {
          enabled: true,
          placeholder: "[Result cleared for token efficiency]"
        },
        
        // Tools to prune (allow list or deny list)
        tools: {
          allow: ["read", "grep", "find", "web_fetch", "web_search"],
          // Or use deny: ["exec", "browser"] to protect certain tools
        }
      }
    }
  }
}
```

---

## 5. Bootstrap File Optimization

### Size Limits

```json5
{
  agents: {
    defaults: {
      bootstrapMaxChars: 8000    // Default: 20000
    }
  }
}
```

### Optimized AGENTS.md Template

Create a lean version of your workspace files:

```markdown
# AGENTS.md (Optimized)

## Session Start
1. Read SOUL.md → embody persona
2. Check memory/YYYY-MM-DD.md → recent context
3. Read MEMORY.md (main session only)

## Core Rules
- Ask before external actions (email, social posts)
- trash > rm (recoverable)
- Group chats: respond when mentioned or adding value
- Silent (HEARTBEAT_OK) for casual banter

## Memory
- Daily: memory/YYYY-MM-DD.md
- Long-term: MEMORY.md (main session only, private)
```

---

## 6. Skills Management

Limit loaded skills to reduce prompt size:

```json5
{
  // In your workspace, create .openclaw/skills.json
  skills: {
    // Only enable needed skills
    enabled: ["weather", "github", "web-search"],
    
    // Or disable heavy/unused skills
    disabled: ["voice-call", "discord", "slack", "1password"]
  }
}
```

---

## 7. Metadata and Envelope Optimization

```json5
{
  agents: {
    defaults: {
      // Disable timestamp/elapsed info in message envelopes
      envelopeTimestamp: "off",   // Default: "on"
      envelopeElapsed: "off"      // Default: "on"
    }
  }
}
```

---

## 8. Thinking/Reasoning Control

Extended thinking consumes significant tokens:

```json5
{
  agents: {
    defaults: {
      thinkingDefault: "off",      // Options: off | minimal | low | medium | high
      
      // For subagents
      subagents: {
        thinking: "off"
      }
    }
  }
}
```

---

## 9. Response Length Limits

```json5
{
  agents: {
    defaults: {
      models: {
        "google/gemini-2.5-flash": {
          params: {
            maxTokens: 2048        // Limit response length
          }
        }
      }
    }
  }
}
```

---

## 10. Memory Search Optimization

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        maxResults: 3,             // Fewer search results
        maxCharsPerResult: 500     // Truncate each result
      }
    }
  }
}
```

---

## 11. Image/Media Optimization

Images can consume ~8000 tokens each:

```json5
{
  agents: {
    defaults: {
      mediaMaxMb: 1               // Auto-resize images over 1MB
    }
  }
}
```

---

## 12. Subagent Optimization

```json5
{
  agents: {
    defaults: {
      subagents: {
        // Use smaller/faster model
        model: "google/gemini-2.5-flash",
        
        // Disable thinking
        thinking: "off",
        
        // Faster archival
        archiveAfterMinutes: 30
      }
    }
  }
}
```

---

## Recommended Configuration

For maximum token efficiency:

```json5
{
  agents: {
    defaults: {
      // 1. Model with caching support
      model: { primary: "google/gemini-2.5-flash" },
      
      // 2. Compact system prompt
      promptMode: "compact",
      
      // 3. Context caching + pruning
      contextPruning: {
        mode: "cache-ttl",
        ttl: "1h",
        softTrimRatio: 0.2,
        hardClearRatio: 0.35
      },
      
      // 4. Compaction settings
      compaction: {
        mode: "safeguard",
        reserveTokensFloor: 10000,
        maxHistoryShare: 0.3
      },
      
      // 5. Bootstrap size limit
      bootstrapMaxChars: 8000,
      
      // 6. Disable envelope metadata
      envelopeTimestamp: "off",
      envelopeElapsed: "off",
      
      // 7. Minimal thinking
      thinkingDefault: "minimal",
      
      // 8. Heartbeat to keep cache warm
      heartbeat: {
        every: "55m"
      },
      
      // 9. Response limits
      models: {
        "google/gemini-2.5-flash": {
          params: {
            cacheRetention: "long",
            maxTokens: 4096
          }
        }
      }
    }
  },
  
  // 10. Channel-specific history limits
  channels: {
    telegram: { dmHistoryLimit: 10 },
    discord: { dmHistoryLimit: 8 }
  },
  messages: {
    groupChat: { historyLimit: 5 }
  }
}
```

---

## Savings Estimate

| Optimization | Savings | Trade-off |
|--------------|---------|-----------|
| Context Caching | 90% input tokens | None |
| Compact Prompt | 50-60% system prompt | Slightly less verbose |
| History Limits | 30-50% history | Less context |
| Tool Pruning | 20-40% tool results | May lose some results |
| Bootstrap Trim | 20-30% bootstrap | Less detailed instructions |
| Thinking Off | 20-50% reasoning | Less detailed reasoning |

**Combined Potential:** 60-80% total token reduction with caching + optimizations.

---

## Monitoring Token Usage

Check your token usage with:

```bash
# Session status shows token counts
openclaw status

# Or use /status command in chat
/status
```

The status output shows:
- `tokens X/Y (Z%)` - current usage vs context window
- `cacheRead` - tokens served from cache (cost savings!)
- `cacheWrite` - tokens written to cache

---

## Related Documentation

- [Session Pruning](/concepts/session-pruning)
- [Anthropic Provider](/providers/anthropic)
- [Token Use Guide](/token-use)
- [Configuration Reference](/reference/configuration)
