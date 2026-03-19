export default async function handler(req, res) {
  try {
    const { prompt, image } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt required" });
    }

    const response = await fetch("https://api.openai.com/v1/images", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        ...(image && { image }),
        size: "1024x1024"
      })
    });

    const text = await response.text();
console.log("RAW OPENAI RESPONSE:", text);

let data;
try {
  data = JSON.parse(text);
} catch (err) {
  throw new Error("OpenAI returned non-JSON → " + text);
}

    if (!response.ok) {
      throw new Error(data.error?.message || "Image failed");
    }

    return res.status(200).json({
      image: data.data[0].url
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
}
