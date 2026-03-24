export const FLOCI_ENDPOINT =
  process.env.AWS_ENDPOINT ?? "http://localhost:4566";

export const FLOCI_REGION =
  process.env.AWS_DEFAULT_REGION ?? "us-east-1";

export const FLOCI_PROFILE =
  process.env.AWS_PROFILE ?? "floci";

export const FLOCI_CREDENTIALS = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test"
};

export function getFlociBaseConfig() {
  return {
    endpoint: FLOCI_ENDPOINT,
    region: FLOCI_REGION,
    credentials: FLOCI_CREDENTIALS
  };
}

export function withEndpointUrl(command: string) {
  return `${command} --profile ${FLOCI_PROFILE} --endpoint-url ${FLOCI_ENDPOINT}`;
}
