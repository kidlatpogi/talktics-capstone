export interface Env {
  AI?: any;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...init.headers,
    },
  });
}

function corsResponse(response: Response) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function runGroqLLM(apiKey: string, payload: any): Promise<any> {
  const isStream = payload?.stream === true;
  const messages = payload?.messages || [];

  const models = ["qwen/qwen3.8-27b", "openai/gpt-oss-20b", "groq/compound-mini"];
  let lastError: any = null;

  for (const model of models) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: 0.5,
          stream: isStream,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq LLM error (${model}) ${res.status}: ${errText}`);
      }

      if (isStream) {
        return res.body;
      }

      const data = (await res.json()) as any;
      const content = data?.choices?.[0]?.message?.content || "";
      return { response: content };
    } catch (err) {
      lastError = err;
      console.warn(`[Groq LLM] Model ${model} failed, trying next:`, getErrorMessage(err));
    }
  }

  throw lastError || new Error("All Groq models failed");
}

async function runGeminiLLM(apiKey: string, payload: any): Promise<any> {
  const isStream = payload?.stream === true;
  if (isStream) {
    // Workers AI natively supports SSE streaming; let env.AI handle it
    throw new Error("Gemini fallback does not support raw SSE stream; delegate to env.AI");
  }

  const messages = payload?.messages || [];
  const systemMsg = messages.find((m: any) => m.role === "system")?.content || "";
  const userMsgs = messages.filter((m: any) => m.role !== "system").map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  
  const fullPrompt = systemMsg ? `${systemMsg}\n\n${userMsgs}` : userMsgs;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: fullPrompt }],
        },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as any;
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { response: content };
}

async function runAIWithRetry(env: Env, model: string, payload: any, maxRetries = 3): Promise<any> {
  if (env.GROQ_API_KEY && model.startsWith("@cf/meta/")) {
    try {
      return await runGroqLLM(env.GROQ_API_KEY, payload);
    } catch (groqErr: any) {
      console.warn(`[Groq LLM Fallback] Groq call failed: ${groqErr?.message || groqErr}. Falling back...`);
    }
  }

  if (env.GEMINI_API_KEY && model.startsWith("@cf/meta/")) {
    try {
      return await runGeminiLLM(env.GEMINI_API_KEY, payload);
    } catch (geminiErr: any) {
      console.warn(`[Gemini LLM Fallback] Gemini call failed: ${geminiErr?.message || geminiErr}. Falling back...`);
    }
  }

  let attempt = 0;
  let delay = 1000;
  while (true) {
    try {
      if (!env.AI) {
        throw new Error("Cloudflare env.AI binding is unavailable.");
      }
      return await env.AI.run(model, payload);
    } catch (e: any) {
      attempt++;
      if (attempt >= maxRetries) throw e;
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("503") || msg.includes("429") || msg.includes("timeout") || msg.includes("overloaded") || msg.includes("internal")) {
        console.warn(`[AI Retry] Model ${model} failed (Attempt ${attempt}): ${e.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        delay *= 1.5;
      } else {
        throw e;
      }
    }
  }
}

const HARD_FILLER_WORDS = new Set([
  "um",
  "uh",
  "ah",
  "eh",
  "oh",
  "e",
  "er",
  "err",
  "erm",
  "em",
  "uhm",
  "uhu",
  "uhuh",
  "huh",
  "hm",
  "hmm",
  "mm",
  "mmm",
  "mhm",
  "mmhm",
  "mmhmm",
]);

const CONTEXTUAL_FILLER_WORDS = new Set([
  "like",
  "well",
  "so",
  "okay",
  "ok",
  "actually",
  "basically",
  "literally",
  "honestly",
  "right",
  "alright",
  "anyway",
  "anyways",
  "kinda",
]);

const FILLER_PHRASES = [
  ["you", "know"],
  ["i", "mean"],
  ["kind", "of"],
  ["sort", "of"],
];

const VERBATIM_FILLER_PROMPT = [
  "Transcribe the speech verbatim.",
  "Do not clean up disfluencies.",
  "Include filler words such as uh, um, uhm, erm, er, ah, eh, oh, mm, mhm, uh-huh, and uh-uh when they are spoken.",
  "Keep the speaker's exact filler words in the transcript.",
].join(" ");

type TranscriptWord = {
  word: string;
  start?: number;
  end?: number;
  confidence?: number;
};

type DeepgramWord = {
  word?: unknown;
  start?: unknown;
  end?: unknown;
  confidence?: unknown;
};

type DeepgramAlternative = {
  transcript?: unknown;
  words?: DeepgramWord[];
};

type DeepgramResponse = {
  text?: unknown;
  results?: {
    channels?: {
      alternatives?: DeepgramAlternative[];
    }[];
  };
};

type FillerOccurrence = TranscriptWord & {
  index: number;
  normalized: string;
  kind: "hard" | "contextual" | "phrase";
};

const punctuationPattern = /[.,/#!$%^&*;:{}=\-_`~()"[\]?]/g;

function normalizeVocalizedFiller(word: string) {
  if (/^u+h+$/.test(word)) return "uh";
  if (/^u+m+$/.test(word)) return "um";
  if (/^u+h*m+$/.test(word)) return "uhm";
  if (/^u+h+u+h+$/.test(word)) return "uhuh";
  if (/^u+h+u+$/.test(word)) return "uhu";
  if (/^a+h+$/.test(word)) return "ah";
  if (/^e+h+$/.test(word)) return "eh";
  if (/^e+r+$/.test(word)) return "er";
  if (/^h+m+$/.test(word)) return "hmm";
  if (/^m+$/.test(word) && word.length > 1) return "mm";
  if (/^m+m+h+m+$/.test(word)) return "mmhm";
  if (/^m+h+m+$/.test(word)) return "mhm";
  return word;
}

function cleanTranscriptWord(word: unknown) {
  return normalizeVocalizedFiller(String(word || "").replace(punctuationPattern, "").toLowerCase());
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function toTranscriptWords(transcript: string, words: TranscriptWord[] = []) {
  if (Array.isArray(words) && words.length > 0) {
    return words
      .map((entry) => ({
        ...entry,
        word: String(entry?.word || "").trim(),
      }))
      .filter((entry) => entry.word);
  }

  return String(transcript || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ({ word }));
}

function getDeepgramAlternative(response: unknown): DeepgramAlternative | null {
  const deepgramResponse = response as DeepgramResponse;
  return deepgramResponse?.results?.channels?.[0]?.alternatives?.[0] || null;
}

function resolveDeepgramTranscript(response: unknown) {
  const alternative = getDeepgramAlternative(response);
  const deepgramResponse = response as DeepgramResponse;
  return String(alternative?.transcript || deepgramResponse?.text || "").trim();
}

function resolveDeepgramWords(response: unknown): TranscriptWord[] {
  const alternative = getDeepgramAlternative(response);
  if (!Array.isArray(alternative?.words)) return [];

  return alternative.words
    .map((entry) => ({
      word: String(entry?.word || "").trim(),
      start: Number.isFinite(Number(entry?.start)) ? Number(entry.start) : undefined,
      end: Number.isFinite(Number(entry?.end)) ? Number(entry.end) : undefined,
      confidence: Number.isFinite(Number(entry?.confidence)) ? Number(entry.confidence) : undefined,
    }))
    .filter((entry: TranscriptWord) => entry.word);
}

function countHardFillers(occurrences: Pick<FillerOccurrence, "kind">[]) {
  return occurrences.filter((occurrence) => occurrence.kind === "hard").length;
}

export function shouldUseFillerAudit(
  currentOccurrences: Pick<FillerOccurrence, "kind">[],
  auditOccurrences: Pick<FillerOccurrence, "kind">[],
) {
  const currentHardCount = countHardFillers(currentOccurrences);
  const auditHardCount = countHardFillers(auditOccurrences);
  return auditHardCount > currentHardCount || (
    auditHardCount === currentHardCount && auditOccurrences.length > currentOccurrences.length
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function transcribeWithGroq(apiKey: string, audioBuffer: ArrayBuffer): Promise<string> {
  const blob = new Blob([audioBuffer], { type: "audio/wav" });
  const formData = new FormData();
  formData.append("file", blob, "audio.wav");
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { text?: string };
  return String(data.text || "").trim();
}

async function transcribeWithWhisper(env: Env, audioBuffer: ArrayBuffer) {
  if (env.GROQ_API_KEY) {
    try {
      console.log("[transcribeWithWhisper] Using Groq Whisper API...");
      return await transcribeWithGroq(env.GROQ_API_KEY, audioBuffer);
    } catch (groqErr: any) {
      console.warn("[transcribeWithWhisper] Groq Whisper failed, falling back to Workers AI:", getErrorMessage(groqErr));
    }
  }

  const audioArray = Array.from(new Uint8Array(audioBuffer));
  let whisperResponse;
  try {
    whisperResponse = await runAIWithRetry(env, "@cf/openai/whisper-large-v3-turbo", {
      audio: audioArray,
    });
  } catch (err: unknown) {
    console.warn("[transcribeWithWhisper] whisper-large-v3-turbo failed, trying fallback:", getErrorMessage(err));
    whisperResponse = await runAIWithRetry(env, "@cf/openai/whisper", {
      audio: audioArray,
    });
  }
  return resolveWhisperLargeTranscript(whisperResponse);
}

function resolveWhisperLargeTranscript(response: unknown) {
  const result = response as {
    text?: unknown;
    transcription_info?: {
      text?: unknown;
    };
  };
  return String(result?.text || result?.transcription_info?.text || "").trim();
}

async function transcribeVerbatimWithWhisperLarge(env: Env, audioBuffer: ArrayBuffer) {
  const audioArray = Array.from(new Uint8Array(audioBuffer));
  const response = await runAIWithRetry(env, "@cf/openai/whisper-large-v3-turbo", {
    audio: audioArray,
    task: "transcribe",
    language: "en",
    initial_prompt: VERBATIM_FILLER_PROMPT,
    condition_on_previous_text: false,
    vad_filter: false,
  });
  return resolveWhisperLargeTranscript(response);
}

export function detectFillerOccurrences(transcript: string, words: TranscriptWord[] = []) {
  const transcriptWords = toTranscriptWords(transcript, words);
  const normalizedWords = transcriptWords.map((entry) => cleanTranscriptWord(entry.word));
  const occurrences = new Map<number, FillerOccurrence>();

  normalizedWords.forEach((normalized, index) => {
    if (HARD_FILLER_WORDS.has(normalized)) {
      occurrences.set(index, {
        ...transcriptWords[index],
        index,
        normalized,
        kind: "hard",
      });
      return;
    }

    if (CONTEXTUAL_FILLER_WORDS.has(normalized)) {
      occurrences.set(index, {
        ...transcriptWords[index],
        index,
        normalized,
        kind: "contextual",
      });
    }
  });

  FILLER_PHRASES.forEach((phrase) => {
    for (let index = 0; index <= normalizedWords.length - phrase.length; index += 1) {
      const matches = phrase.every((part, offset) => normalizedWords[index + offset] === part);
      if (!matches) continue;

      phrase.forEach((_, offset) => {
        const wordIndex = index + offset;
        occurrences.set(wordIndex, {
          ...transcriptWords[wordIndex],
          index: wordIndex,
          normalized: normalizedWords[wordIndex],
          kind: "phrase",
        });
      });
    }
  });

  return Array.from(occurrences.values()).sort((a, b) => a.index - b.index);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "b01-ai-worker",
        status: "online",
      });
    }

    // --- ROUTE: /banner-message (Dynamic Greetings) ---
    if (url.pathname === "/banner-message" && request.method === "POST") {
      try {
        const { context } = await request.json() as { context: any };
        
        const prompt = `You are B-01, an AI speaking coach for students in Dasmariñas, Cavite. 
        Generate a short, enthusiastic greeting for the user's dashboard.
        
        User Progress Context:
        ${JSON.stringify(context)}
        
        Tone: Friendly, encouraging, and relatable to a student in Cavite. 
        Requirements:
        1. Be extremely concise (10-15 words max).
        2. Mention a specific stat if relevant (e.g. "Improved by 5%!" or "3-day streak!").
        3. Use simple, clear English.
        4. Do NOT use hashtags or emojis.
        5. IMPORTANT: Do NOT include quotation marks in the output. Just the plain text message.
        
        Output only the message text.`;

        const response = await runAIWithRetry(env, "@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            { role: "system", content: "You are a helpful dashboard assistant for students in Dasmariñas, Cavite." },
            { role: "user", content: prompt }
          ]
        });

        return jsonResponse({
          message: response.response.trim().replace(/^"|"$/g, ''),
        });
      } catch (e: any) {
        return jsonResponse({ error: e.message }, { status: 500 });
      }
    }

    // --- ROUTE: /random-topic (Dynamic Practice Topics) ---
    if (url.pathname === "/random-topic") {
      try {
        const prompt = `Generate a super casual, "slice-of-life" public speaking topic for a student in Dasmariñas, Cavite (SHS/College).
        
        Tone: Very friendly, informal, and grounded. 
        Think: "TikTok storytime," "vlog topic," or "chatting with a friend."
        
        Requirements:
        1. Topics must be about things students see, hear, do, or think about daily in Dasmariñas/Cavite (e.g., traffic in Aguinaldo Highway, SM Dasma hangouts, Kadiwa market, local campus life, or Cavite weather).
        2. Titles should be catchy and informal (e.g., "The Aguinaldo Highway Struggle," "SM Dasma vs Robinson's," "Why I Love/Hate Cavite Traffic").
        3. Provide a title and a 1-sentence instruction that is supportive and low-pressure.
        4. Return ONLY a JSON object: {"title": "...", "body": "..."}`;

        const response = await runAIWithRetry(env, "@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            { role: "system", content: "You are a friendly, relatable vlog-style topic generator for students in Dasmariñas, Cavite. Output only valid JSON." },
            { role: "user", content: prompt }
          ]
        });

        let finalData;
        try {
          const rawText = response.response;
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          finalData = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: "Failed to parse topic" };
        } catch (e) {
          finalData = { error: "Topic generation failed" };
        }

        return jsonResponse(finalData);
      } catch (e: any) {
        return jsonResponse({ error: e.message }, { status: 500 });
      }
    }

    // --- ROUTE: /transcribe (Used by Python Backend) ---
    if (url.pathname === "/transcribe" && request.method === "POST") {
      try {
        const audioBuffer = await request.arrayBuffer();
        const contentType = request.headers.get("Content-Type") || "audio/webm";

        let transcript = "";
        let transcriptWords: TranscriptWord[] = [];
        let transcriptionModel = "@cf/openai/whisper-large-v3-turbo";
        const shouldAuditFillers = url.searchParams.get("audit_fillers") === "true";

        try {
          transcript = await transcribeWithWhisper(env, audioBuffer);
        } catch (whisperError: unknown) {
          console.warn("[transcribe] Transcription failed:", getErrorMessage(whisperError));
        }

        let fillerOccurrences = detectFillerOccurrences(transcript, transcriptWords);
        let fillerAuditTranscript = "";
        let fillerAuditCount = 0;
        let fillerAuditModel = "";

        if (shouldAuditFillers) {
          // Additional filler audit call disabled to prevent duplicate audio transcription calls.
          // Fillers are detected directly from the primary transcript above.
          fillerAuditModel = "skipped-for-performance";
        }

        const fillerWords = fillerOccurrences.map((occurrence) => occurrence.word);
        const hardFillerCount = countHardFillers(fillerOccurrences);

        // 2. Fast Verbal Analysis using Llama-3
        // Filler counting is deterministic above, so the LLM only handles semantic judgment.
        const topic = url.searchParams.get("topic") || "General Speaking";
        
        const analysisPrompt = `Analyze this transcript for a public speaking app.
        Transcript: "${transcript}"
        Topic: "${topic}"
        
        Tasks:
        1. Give a relevance score (1.0 to 5.0) compared to the topic.
        2. Provide 2 short verbal coaching tips.
        3. Identify any words in the transcript that are likely mispronounced, misspelled, grammatically incorrect in context, or phonetic misinterpretations of words (especially Philippine names, places, or common English words, e.g. "Vite" instead of "Cavite", "Bullyan" instead of "Bulihan", "Selangka" instead of "Silang", "Las Marinas" instead of "Dasmariñas"). Return them in a "mispronunciations" array where each item has "word" (exactly as it appears in the transcript) and "correction" (the correct spelling/word).
        Do not count filler words. They are computed separately by code.

        Return ONLY a JSON object:
        {
          "relevance_score": 0.0,
          "recommendations": ["tip1", "tip2"],
          "mispronunciations": [
            {"word": "example_misspelled", "correction": "example_correct"}
          ]
        }`;

        const analysisResponse = await runAIWithRetry(env, "@cf/meta/llama-3.1-8b-instruct-fp8", {
          messages: [
            { role: "system", content: "You are a speech analysis engine. Output only valid JSON." },
            { role: "user", content: analysisPrompt }
          ]
        });

        // Parse Llama's response (handling potential markdown)
        let finalData;
        try {
          const rawText = typeof analysisResponse === 'string' ? analysisResponse : String(analysisResponse?.response || "");
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          finalData = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: "Failed to parse analysis" };
        } catch (e) {
          finalData = { transcript, error: "Analysis failed, but transcription succeeded" };
        }

        return jsonResponse({
          ...finalData,
          transcript,
          transcription_model: transcriptionModel,
          filler_count: fillerOccurrences.length,
          hard_filler_count: hardFillerCount,
          filler_words: fillerWords,
          filler_occurrences: fillerOccurrences,
          filler_audit_model: fillerAuditModel,
          filler_audit_count: fillerAuditCount,
          filler_audit_transcript: fillerAuditTranscript,
        });

      } catch (e: any) {
        console.error("Transcribe Error:", e.stack || e.message);
        return jsonResponse({ error: e.message, stack: e.stack }, { status: 500 });
      }
    }

    // --- ROUTE: /chat (B-01 Interactive Coach) ---
    if (request.method === "POST") {
      try {
        const { messages } = await request.json() as { messages: any[] };

        // Extract context
        const contextMsg = messages.find(m => m.role === 'system' && m.content.startsWith('CONTEXT:'));
        const filteredMessages = messages.filter(m => m !== contextMsg);

        const systemPrompt = `You are B-01, a highly specialized, NO-FLUFF AI Public Speaking Coach.
        
        ${contextMsg ? `USER DATA:\n${contextMsg.content}\n
        INSTRUCTIONS:\n
        1. Use 'fullTimeline' for growth analysis.
        2. ALWAYS provide exact percentage growth.
        3. Be extremely CONCISE (2 sentences max).` : 'No data available.'}

        STRICT RULES:
        - Never say "I don't have data".
        - Data-first answers only.`;

        const stream = await runAIWithRetry(env, '@cf/meta/llama-3.1-8b-instruct-fp8', {
          messages: [
            { role: 'system', content: systemPrompt },
            ...filteredMessages
          ],
          stream: true
        });

        return corsResponse(new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
          },
        }));
      } catch (e: any) {
        return jsonResponse({ error: e.message }, { status: 500 });
      }
    }

    return corsResponse(new Response("Not Found", { status: 404 }));
  },
};
