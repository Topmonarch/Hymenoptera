import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, image } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt required" });
    }

    let result;

    // 🧠 IF IMAGE EXISTS → EDIT MODE
    if (image) {
      result = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        image: image, // base64 image OR URL
        size: "1024x1024"
      });
    } else {
      // 🎨 NORMAL GENERATION
      result = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        size: "1024x1024"
      });
    }

    return res.status(200).json({
      image: result.data[0].b64_json
    });

  } catch (error) {
    console.error("IMAGE ERROR:", error);
    return res.status(500).json({
      error: error.message
    });
  }
}
