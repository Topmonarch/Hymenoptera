export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages } = req.body;

    // Validate messages exist
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages must be an array" });
    }

    // Check for API key
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: messages
      })
    });

    // Check if API response was successful
    if (!response.ok) {
      const errorData = await response.json();
      console.error("OpenAI API error:", errorData);
      return res.status(response.status).json({ 
        reply: "Error from OpenAI API",
        error: errorData.error?.message 
      });
    }

    const data = await response.json();

    // Chat Completions API returns choices array
    const reply = data.choices?.[0]?.message?.content || "No response received";

    res.status(200).json({ reply });

  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      reply: "Server error.",
      error: error.message
    });
  }
}
