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

    // 🛑 Require prompt
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    let response;

    // 🧠 EDIT MODE (image provided)
    if (image) {
      response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        image: image, // 🔥 base64 string from frontend
        size: "1024x1024",
      });
    } 
    // 🎨 GENERATE MODE (no image)
    else {
      response = await openai.images.generate({
        model: "gpt-image-1",
        prompt: prompt,
        size: "1024x1024",
      });
    }

    // ✅ Return base64 image
    const imageBase64 = response.data[0].b64_json;

    return res.status(200).json({
      image: imageBase64,
    });

  } catch (error) {
    console.error("IMAGE GENERATION ERROR:", error);

    return res.status(500).json({
      error: error.message || "Something went wrong",
    });
  }
}
