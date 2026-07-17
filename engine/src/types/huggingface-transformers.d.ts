export interface ChatMessage {
  readonly content: string;
  readonly role: string;
}

export type Chat = ChatMessage[];

export interface TextGenerationResult {
  readonly generated_text: readonly ChatMessage[];
}

export interface TextGenerationPipeline {
  (
    messages: Chat,
    options: Readonly<{
      do_sample: boolean;
      max_new_tokens: number;
      streamer?: TextStreamer;
      tokenizer_encode_kwargs?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<readonly TextGenerationResult[]>;
  readonly tokenizer: {
    apply_chat_template(
      messages: Chat,
      options: Readonly<{
        add_generation_prompt: boolean;
        return_dict: false;
        return_tensor: false;
        tokenize: true;
        tokenizer_kwargs?: Readonly<Record<string, unknown>>;
      }>,
    ): readonly number[];
    chat_template: string | null;
  };
}

export interface TransformersEnvironment {
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
  customCache: Readonly<{
    match(request: string): Promise<Response | undefined>;
    put(
      request: string,
      response: Response,
      progress?: (data: { loaded: number; progress: number; total: number }) => void,
    ): Promise<void>;
  }> | null;
  useBrowserCache: boolean;
  useCustomCache: boolean;
  useWasmCache: boolean;
}

export const env: TransformersEnvironment;

export function pipeline(
  task: "text-generation",
  model: string,
  options: Readonly<{
    device: "wasm" | "webgpu";
    dtype: string;
    progress_callback(update: unknown): void;
    revision: string;
  }>,
): Promise<TextGenerationPipeline>;

export class TextStreamer {
  constructor(
    tokenizer: TextGenerationPipeline["tokenizer"],
    options: Readonly<{
      skip_prompt: boolean;
      skip_special_tokens: boolean;
      token_callback_function(tokens: readonly bigint[]): void;
    }>,
  );
}
