const https = require("https");

exports.handler = async (event) => {
  // Permitir preflight CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "MP_ACCESS_TOKEN no configurado en Netlify" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body inválido" }) };
  }

  const { nombre, precio, cantidad = 1 } = body;
  if (!nombre || !precio) {
    return { statusCode: 400, body: JSON.stringify({ error: "Faltan nombre o precio" }) };
  }

  // Detectar si es token de prueba (empieza con TEST-)
  const isSandbox = ACCESS_TOKEN.startsWith("TEST-");
  const siteUrl = process.env.URL || "https://pertlatcg.netlify.app";

  const preference = {
    items: [
      {
        title: nombre,
        quantity: Number(cantidad),
        unit_price: Number(precio),
        currency_id: "ARS",
      },
    ],
    back_urls: {
      success: `${siteUrl}/?pago=ok`,
      failure: `${siteUrl}/?pago=error`,
      pending: `${siteUrl}/?pago=pendiente`,
    },
    auto_return: "approved",
    // En modo prueba MP no requiere notification_url real
    ...(isSandbox ? {} : { notification_url: `${siteUrl}/.netlify/functions/mp-webhook` }),
  };

  const data = JSON.stringify(preference);

  return new Promise((resolve) => {
    const options = {
      hostname: "api.mercadopago.com",
      path: "/checkout/preferences",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode === 201) {
            // En sandbox usar sandbox_init_point, en prod usar init_point
            const url = isSandbox
              ? (parsed.sandbox_init_point || parsed.init_point)
              : parsed.init_point;
            resolve({
              statusCode: 200,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ init_point: url }),
            });
          } else {
            console.error("MP error:", res.statusCode, responseData);
            resolve({
              statusCode: res.statusCode,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ error: parsed.message || "Error de MercadoPago" }),
            });
          }
        } catch (e) {
          resolve({
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Error parseando respuesta de MP" }),
          });
        }
      });
    });

    req.on("error", (e) => {
      resolve({
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: e.message }),
      });
    });

    req.write(data);
    req.end();
  });
};
