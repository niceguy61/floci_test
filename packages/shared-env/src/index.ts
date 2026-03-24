export const REQUIRED_HANDSON_ENV = {
  AWS_ENDPOINT: "http://localhost:4566",
  AWS_DEFAULT_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test"
} as const;

export function readHandsonEnv(env: NodeJS.ProcessEnv = process.env) {
  return {
    endpoint: env.AWS_ENDPOINT ?? REQUIRED_HANDSON_ENV.AWS_ENDPOINT,
    region: env.AWS_DEFAULT_REGION ?? REQUIRED_HANDSON_ENV.AWS_DEFAULT_REGION,
    accessKeyId:
      env.AWS_ACCESS_KEY_ID ?? REQUIRED_HANDSON_ENV.AWS_ACCESS_KEY_ID,
    secretAccessKey:
      env.AWS_SECRET_ACCESS_KEY ?? REQUIRED_HANDSON_ENV.AWS_SECRET_ACCESS_KEY
  };
}
