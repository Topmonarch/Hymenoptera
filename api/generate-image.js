'use strict';

module.exports = async function handler(req, res) {
  try {
    const imageData = req.body.referenceImages[0].data;
    const prompt = 'Convert this exact drawing into a highly realistic image. Preserve the exact shape, structure, and proportions. Do not change the design. Only enhance realism.';

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('image', imageBuffer, {
  filename: 'image.png',
  contentType: 'image/png'
});
    formData.append('size', '1024x1024');

    const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      throw new Error(data.error?.message || `OpenAI error ${openaiRes.status}`);
    }

    const imageBase64 = data.data[0].b64_json;
    const resultUrl = `data:image/png;base64,${imageBase64}`;
    return res.status(200).json({ imageUrl: resultUrl });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
