'use strict';

module.exports = async function handler(req, res) {
  try {
    const imageData = req.body.referenceImages[0].data;
    const prompt = 'Convert this exact drawing into a highly realistic image. Preserve the exact shape, structure, and proportions. Do not change the design. Only enhance realism.';

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        image: imageData,
        size: '1024x1024'
      })
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      throw new Error(data.error?.message || `OpenAI error ${openaiRes.status}`);
    }

    const resultUrl = data.data[0].url;
    return res.status(200).json({ imageUrl: resultUrl });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
