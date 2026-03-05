const response = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
  },
  body: JSON.stringify({
    model: "gpt-4o-mini",
    input: conversation,
    stream: false
  })
});
