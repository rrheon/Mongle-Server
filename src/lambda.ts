import serverlessExpress from '@codegenie/serverless-express';
import { createApp } from './app';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';

// Express 앱 생성
const app = createApp();

// Serverless Express 핸들러
const serverlessHandler = serverlessExpress({ app });

// Lambda 핸들러
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<unknown> => {
  // Lambda 컨텍스트 설정
  context.callbackWaitsForEmptyEventLoop = false;

  return serverlessHandler(event, context, () => {});
};
