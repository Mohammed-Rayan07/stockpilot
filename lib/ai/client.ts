import { GoogleGenAI } from '@google/genai';

// Server-side only. Never imported from a Client Component -- the key would end up in
// the bundle. Nothing under app/(app) or components/ imports this directly; only the
// executor and the route handlers under app/api/ai do.

export const GEMINI_MODEL = 'gemini-2.5-flash';

let client: GoogleGenAI | undefined;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    client = new GoogleGenAI({ apiKey });
  }

  return client;
}
