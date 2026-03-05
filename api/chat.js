if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const { messages } = req.body;

    // convert the incoming chat-style messages into a single text input for the new Responses API
    const conversation = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: conversation
      })
    });

    const data = await response.json();

    // new API returns an output array; take the first text snippet
    const reply = data.output?.[0]?.content?.[0]?.text || "";

    res.status(200).json({ reply });

  } catch (error) {

    res.status(500).json({
      reply: "Server error."
    });

  }

}


}
