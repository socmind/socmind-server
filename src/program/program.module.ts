// src/program/program.module.ts
import { Module } from '@nestjs/common';
import { ChatModule } from 'src/chat/chat.module';
import { GatewayModule } from 'src/gateway/gateway.module';
import { ProgramService } from './program.service';
import { ProgramController } from './program.controller';
import { LastInWinsMutex } from './program.mutex';
import { Gpt4oState } from './gpt-4o/gpt-4o.state';
import { o3MiniState } from './o3-mini/o3-mini.state';
import { ClaudeState } from './claude/claude.state';
import { GeminiState } from './gemini/gemini.state';
import { GrokState } from './grok/grok.state';
import { LlamaState } from './llama/llama.state';
import { DeepseekState } from './deepseek/deepseek.state';
import { QwenState } from './qwen/qwen.state';
import { KimiState } from './kimi/kimi.state';
import { StepState } from './step/step.state';
import { WebSearchAgentState } from './web-search-agent/web-search-agent.state';

@Module({
  imports: [
    ChatModule,
    GatewayModule,
  ],
  providers: [
    ProgramService,
    LastInWinsMutex,
    Gpt4oState,
    o3MiniState,
    ClaudeState,
    GeminiState,
    GrokState,
    LlamaState,
    DeepseekState,
    QwenState,
    KimiState,
    StepState,
    WebSearchAgentState,
  ],
  controllers: [ProgramController],
})
export class ProgramModule { }
