export interface SecretFixtureCase {
  id: string;
  label: string;
  token: string;
  /** Fragments that must NOT survive redaction in any boundary. */
  forbiddenFragments: string[];
  /** True when scanBufferForSecrets (repo file scanner) must detect it. */
  detectedByFileScanner: boolean;
  /** True when extractor's orphan/PEM/token redaction must scrub it. */
  detectedByExtractor: boolean;
}

/**
 * Dynamically constructs synthetic secret test fixtures so no static contiguous
 * credentials are stored in repository files while testing exact real-world shapes.
 */
export function buildSecretFixtures(): SecretFixtureCase[] {
  const slackXoxb = ["xoxb", "1234567890", "123456789012", "AbCdEfGhIjKlMnOpQrStUvWx"].join(
    "-",
  );
  const slackXoxbShort = ["xoxb", "12345", "123456789012", "AbCdEf"].join("-");
  const slackXoxp = ["xoxp", "12345", "9999999999", "ZyxWvUtSrQpOnM"].join("-");
  const slackXoxa = ["xoxa", "2", "1234567890", "AbCdEfGhIjKl"].join("-");
  const slackXoxr = ["xoxr", "1234567890", "1234567890", "MnOpQrStUvWx"].join("-");
  const slackXoxs = ["xoxs", "12345", "67890", "AbCdEfGhIjKl"].join("-");

  const openAiSk = ["sk", "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"].join("-");
  const openAiProj = ["sk", "proj", "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"].join("-");

  const ghClassic = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_");
  const ghOauth = ["gho", "B1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R7s8"].join("_");
  const ghUser = ["ghu", "C1d2E3f4G5h6I7j8K9l0M1n2O3p4Q5r6S7t8"].join("_");
  const ghServer = ["ghs", "D1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T7u8"].join("_");
  const ghRefresh = ["ghr", "E1f2G3h4I5j6K7l8M9n0O1p2Q3r4S5t6U7v8"].join("_");

  const ghFineShort = ["github", "pat", "ShortSyntheticToken1234567890"].join("_");
  const ghFineFull = ["github", "pat", "A".repeat(22) + "_" + "B".repeat(59)].join("_");

  const sentrySpecial = ["sntrys", "abc_def-123=456789012345678901234567890=="].join("_");

  const awsAkia = "AKIA" + "0123456789ABCDEF";
  const awsAsia = "ASIA" + "FEDCBA9876543210";

  const pemBeginBlock = ["-----BEGIN", "RSA", "PRIVATE", "KEY", "BLOCK-----"].join(" ");
  const pemEndBlock = ["-----END", "RSA", "PRIVATE", "KEY", "BLOCK-----"].join(" ");
  const pemBlockComplete = `${pemBeginBlock}\nMIIEowIBAAKCAQEASecretBlockBody\n${pemEndBlock}`;

  const pemBeginUnterm = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const pemUntermDa = `${pemBeginUnterm}\r\nMIIEvQIBADANBgkqhkiG9w0\r\ndA==`;

  const pemEndOrphan = ["-----END", "EC", "PRIVATE", "KEY-----"].join(" ");

  const dbUrlEncoded = "postgresql://alice:pa%2Fss%40word99@db.example.internal:5432/prod";
  const dbUrlWithSlash = "postgres://bob:super/secret/pass99@db.example.internal:5432/prod";
  const bearerTok = ["Bearer", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_payload"].join(" ");
  const basicHdr = "Authorization: Basic " + "dXNlcjpTdXBlclNlY3JldDEyMw==";

  return [
    {
      id: "slack-xoxb-standard",
      label: "Slack xoxb multi-segment",
      token: slackXoxb,
      forbiddenFragments: ["1234567890", "123456789012", "AbCdEfGhIjKlMnOpQrStUvWx"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "slack-xoxb-short-first",
      label: "Slack xoxb short first segment",
      token: slackXoxbShort,
      forbiddenFragments: ["12345", "123456789012", "AbCdEf"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "slack-xoxp",
      label: "Slack xoxp",
      token: slackXoxp,
      forbiddenFragments: ["9999999999", "ZyxWvUtSrQpOnM"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "slack-xoxa",
      label: "Slack xoxa",
      token: slackXoxa,
      forbiddenFragments: ["1234567890", "AbCdEfGhIjKl"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "slack-xoxr",
      label: "Slack xoxr",
      token: slackXoxr,
      forbiddenFragments: ["1234567890", "MnOpQrStUvWx"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "slack-xoxs",
      label: "Slack xoxs",
      token: slackXoxs,
      forbiddenFragments: ["67890", "AbCdEfGhIjKl"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "openai-sk",
      label: "OpenAI sk-",
      token: openAiSk,
      forbiddenFragments: ["AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "openai-sk-proj",
      label: "OpenAI sk-proj-",
      token: openAiProj,
      forbiddenFragments: ["AbCdEfGhIjKlMnOpQrStUvWxYz1234567890"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-ghp",
      label: "GitHub ghp_",
      token: ghClassic,
      forbiddenFragments: ["A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-gho",
      label: "GitHub gho_",
      token: ghOauth,
      forbiddenFragments: ["B1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R7s8"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-ghu",
      label: "GitHub ghu_",
      token: ghUser,
      forbiddenFragments: ["C1d2E3f4G5h6I7j8K9l0M1n2O3p4Q5r6S7t8"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-ghs",
      label: "GitHub ghs_",
      token: ghServer,
      forbiddenFragments: ["D1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T7u8"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-ghr",
      label: "GitHub ghr_",
      token: ghRefresh,
      forbiddenFragments: ["E1f2G3h4I5j6K7l8M9n0O1p2Q3r4S5t6U7v8"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-pat-short",
      label: "GitHub fine-grained variable short",
      token: ghFineShort,
      forbiddenFragments: ["ShortSyntheticToken1234567890"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "github-pat-full",
      label: "GitHub fine-grained 82-char",
      token: ghFineFull,
      forbiddenFragments: ["B".repeat(59)],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "sentry-special",
      label: "Sentry sntrys_ with _ - =",
      token: sentrySpecial,
      forbiddenFragments: ["abc_def-123=456789012345678901234567890=="],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "aws-akia",
      label: "AWS AKIA key",
      token: awsAkia,
      forbiddenFragments: ["0123456789ABCDEF"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "aws-asia",
      label: "AWS ASIA key",
      token: awsAsia,
      forbiddenFragments: ["FEDCBA9876543210"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "pem-block-armor",
      label: "PEM BLOCK armor",
      token: pemBlockComplete,
      forbiddenFragments: ["MIIEowIBAAKCAQEASecretBlockBody", "PRIVATE KEY"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "pem-unterm-da",
      label: "PEM unterminated EOF dA==",
      token: pemUntermDa,
      forbiddenFragments: ["MIIEvQIBADANBgkqhkiG9w0", "dA==", "PRIVATE KEY"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "pem-orphan-end",
      label: "PEM orphan END header",
      token: `safe_before\n${pemEndOrphan}\nsafe_after`,
      forbiddenFragments: ["PRIVATE KEY"],
      detectedByFileScanner: true,
      detectedByExtractor: true,
    },
    {
      id: "db-url-encoded",
      label: "DB connection URI with URL-encoded password",
      token: dbUrlEncoded,
      forbiddenFragments: ["pa%2Fss%40word99"],
      detectedByFileScanner: false,
      detectedByExtractor: true,
    },
    {
      id: "db-url-slash",
      label: "DB connection URI with slashes in password",
      token: dbUrlWithSlash,
      forbiddenFragments: ["super/secret/pass99"],
      detectedByFileScanner: false,
      detectedByExtractor: true,
    },
    {
      id: "bearer-header",
      label: "Bearer token",
      token: bearerTok,
      forbiddenFragments: ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9_payload"],
      detectedByFileScanner: false,
      detectedByExtractor: true,
    },
    {
      id: "basic-auth-header",
      label: "Basic Authorization header",
      token: basicHdr,
      forbiddenFragments: ["dXNlcjpTdXBlclNlY3JldDEyMw=="],
      detectedByFileScanner: false,
      detectedByExtractor: true,
    },
  ];
}

export const NON_SECRET_SOURCE_CONTROLS = [
  "sk-button-primary-navigation-drawer",
  "Basic validation check passed without errors",
  "export function tokenizeStream(authTokenCount: number) { return authTokenCount + 1; }",
  "DATABASE_URL=postgres://user:pass@localhost:5432/db\nAPI_SECRET=placeholder_secret_value",
];
