import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Swagger JSON을 반환하는 Lambda 핸들러
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const swaggerDocument = require('../dist/swagger.json');

    // /docs 경로인 경우 Swagger UI HTML 반환
    if (event.path === '/docs' || event.path === '/docs/') {
      const html = generateSwaggerHtml();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
        },
        body: html,
      };
    }

    // /docs/swagger.json 경로인 경우 JSON 반환
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(swaggerDocument),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Swagger document not found' }),
    };
  }
};

function generateSwaggerHtml(): string {
  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mongle API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: '/docs/swagger.json',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout",
        persistAuthorization: true
      });
    };
  </script>
</body>
</html>
  `.trim();
}
