import serverlessExpress from '@codegenie/serverless-express';
import { createApp } from './app';
import { APIGatewayProxyEvent, Context, Callback, APIGatewayProxyResult } from 'aws-lambda';

// Express 앱 생성
const app = createApp();

// Serverless Express 핸들러
const serverlessHandler = serverlessExpress({ app });

// Lambda 핸들러
export const handler = (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback<APIGatewayProxyResult>
): void => {
  // Lambda 컨텍스트 설정
  context.callbackWaitsForEmptyEventLoop = false;

  serverlessHandler(event, context, callback);
};
