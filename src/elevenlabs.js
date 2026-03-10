const VOICES_URL = "https://api.elevenlabs.io/v1/voices";

export async function fetchVoices(apiKey) {
  if (!apiKey?.trim()) throw new Error("API key required");
  const res = await fetch(VOICES_URL, {
    headers: { "xi-api-key": apiKey.trim() },
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid API key");
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.voices || []).map((v) => ({
    voice_id: v.voice_id,
    name: v.name || v.voice_id,
  }));
}

export async function convertToVoice(apiKey, voiceId, audioBlob, options = {}) {
  if (!apiKey?.trim()) throw new Error("API key required");
  if (!voiceId?.trim()) throw new Error("Voice required");
  if (!audioBlob || !(audioBlob instanceof Blob))
    throw new Error("Audio required");
  const form = new FormData();
  form.append("audio", audioBlob);
  if (options.model_id != null) form.append("model_id", String(options.model_id));
  if (options.remove_background_noise != null)
    form.append("remove_background_noise", options.remove_background_noise ? "true" : "false");
  const voiceSettings = {};
  if (options.stability != null) voiceSettings.stability = Number(options.stability);
  if (options.similarity_boost != null) voiceSettings.similarity_boost = Number(options.similarity_boost);
  if (Object.keys(voiceSettings).length) form.append("voice_settings", JSON.stringify(voiceSettings));
  const params = new URLSearchParams();
  if (options.output_format != null) params.set("output_format", options.output_format);
  const url = `https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(voiceId)}${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey.trim() },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
  return await res.blob();
}
