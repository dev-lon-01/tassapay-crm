/**
 * TassaPay backoffice API client.
 *
 * Flow:
 *   1. POST /LoginHandler.ashx?Task=1  → receive session cookies + encrypted credentials
 *   2. POST /CustomerHandler.ashx/?Task=search  → return customer list
 *
 * Both calls run server-side (API routes / RSC) – never in the browser.
 */

const BASE = "https://tassapay.co.uk/backoffice";

const SHARED_HEADERS: Record<string, string> = {
  accept: "*/*",
  "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  origin: "https://tassapay.co.uk",
  pragma: "no-cache",
  "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "x-requested-with": "XMLHttpRequest",
};

// ─── types ────────────────────────────────────────────────────────────────────

export interface LoginResponseItem {
  Status: string;
  ErrorMessage: string;
  Name: string;
  Role_ID: string;
  User_ID: string;
  Branch_ID: string;
  Client_ID: string;
  LoginBranch: string;
  Branch_Key: string;
  RedirectUrl: string;
  Till_ID: string;
  Agent_branch: string;
  E_User_Nm: string;
  E_Password: string;
  E_Branch_key: string;
  [key: string]: string;
}

export interface LoginResult {
  loginData: LoginResponseItem;
  /** Ready-to-use Cookie header value for subsequent requests */
  cookieHeader: string;
}

export interface CustomerSearchParams {
  CustomerName?: string;
  fromdate?: string; // dd/MM/yyyy
  todate?: string;   // dd/MM/yyyy
  BlackList?: string;
  id_verification_status?: string;
  Risk_Level?: string;
}

export interface TransferSearchParams {
  fromdate?: string; // dd/MM/yyyy
  todate?: string;   // dd/MM/yyyy
  /** Filter by specific sender reference (WireTransfer_ReferanceNo / customer_id) */
  WireTransfer_ReferanceNo?: string;
  /** Filter by specific transaction reference number */
  trn_referenceNo?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayDDMMYYYY(): string {
  return formatDDMMYYYY(new Date());
}

function formatDDMMYYYY(d: Date): string {
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 31);
  return formatDDMMYYYY(d);
}

/**
 * Extract cookie key=value pairs from Set-Cookie response headers.
 *
 * Next.js 13 (undici-based fetch on Node ≤18) may not expose
 * getSetCookie(), so we fall back to a forEach scan which undici
 * DOES support – it yields each Set-Cookie line separately.
 */
function parseSetCookies(headers: Headers): string[] {
  const results: string[] = [];

  // undici Headers forEach calls the callback once PER header line,
  // even for repeated names like Set-Cookie.
  headers.forEach((value: string, name: string) => {
    if (name.toLowerCase() === "set-cookie") {
      const kv = value.split(";")[0].trim(); // strip path/expires/etc.
      if (kv) results.push(kv);
    }
  });

  return results;
}

// ─── step 1: login ────────────────────────────────────────────────────────────

export async function login(
  username: string,
  password: string,
  branchKey: string
): Promise<LoginResult> {
  const res = await fetch(`${BASE}/LoginHandler.ashx?Task=1`, {
    method: "POST",
    headers: {
      ...SHARED_HEADERS,
      "content-type": "application/json; charset=UTF-8",
      referer: "https://tassapay.co.uk/backoffice/login",
    },
    body: JSON.stringify({
      Param: [
        {
          username,
          password,
          BranchKey: branchKey,
          reCaptcha: "",
          remcondition: true,
        },
      ],
    }),
    // Disable automatic cookie jar – we manage cookies ourselves
    credentials: "omit",
  });

  if (!res.ok) {
    throw new Error(`Login HTTP error: ${res.status} ${res.statusText}`);
  }

  const json: LoginResponseItem[] = await res.json();
  const loginData = json[0];

  if (loginData.Status !== "0") {
    throw new Error(
      `Login failed: ${loginData.ErrorMessage || "Unknown error"}`
    );
  }

  // Server sets ASP.NET_SessionId and SessionID via Set-Cookie headers.
  // The body gives us the base64-encoded username/password/branchkey that
  // the browser stores as plain cookies.
  const serverCookies = parseSetCookies(res.headers);

  const cookieParts = [
    `username=${encodeURIComponent(loginData.E_User_Nm)}`,
    `password=${encodeURIComponent(loginData.E_Password)}`,
    `mtsbranchkey=${encodeURIComponent(loginData.E_Branch_key)}`,
    `remember=true`,
    `Till_ID=${loginData.Till_ID ?? "0"}`,
    ...serverCookies,
  ];

  return { loginData, cookieHeader: cookieParts.join("; ") };
}

// ─── step 2: customer search ──────────────────────────────────────────────────

export async function searchCustomers(
  cookieHeader: string,
  loginData: LoginResponseItem,
  params: CustomerSearchParams = {}
) {
  const res = await fetch(`${BASE}/CustomerHandler.ashx/?Task=search`, {
    method: "POST",
    headers: {
      ...SHARED_HEADERS,
      "content-type": "application/json;",
      referer: "https://tassapay.co.uk/backoffice/customers",
      cookie: cookieHeader,
    },
    body: JSON.stringify({
      Param: [
        {
          Chk_Date: "false",
          latest_id: "1",
          CustomerName: params.CustomerName ?? "",
          WireTransfer_ReferanceNo: "",
          Email_ID: "",
          Post_Code: "",
          Mobile_Number: "",
          BlackList: params.BlackList ?? "-1",
          Delete_Status: null,
          File_Ref: "",
          Branch_ID: -1,
          Client_ID: loginData.Client_ID,
          User_ID: loginData.User_ID,
          Username: loginData.Name,
          id_verification_status: params.id_verification_status ?? "-1",
          Risk_Level: params.Risk_Level ?? "-1",
          fromdate: params.fromdate ?? defaultFromDate(),
          todate: params.todate ?? todayDDMMYYYY(),
          C_User_ID: -1,
          ApplyUserFilter: 0,
          Sourse_of_Registration: "",
          Sender_DateOfBirth: "",
          agent_branch: loginData.Agent_branch ?? "1",
          CommentPriority: "-1",
        },
      ],
    }),
    credentials: "omit",
  });

  if (!res.ok) {
    throw new Error(
      `Customer search HTTP error: ${res.status} ${res.statusText}`
    );
  }

  return res.json();
}

// ─── step 2b: transaction search ─────────────────────────────────────────────

export async function searchTransfers(
  cookieHeader: string,
  loginData: LoginResponseItem,
  params: TransferSearchParams = {}
) {
  const res = await fetch(`${BASE}/Send.ashx/?Task=Transaction_Search`, {
    method: "POST",
    headers: {
      ...SHARED_HEADERS,
      "content-type": "application/json;",
      referer: "https://tassapay.co.uk/backoffice/transfer-history",
      cookie: cookieHeader,
    },
    body: JSON.stringify({
      Param: [
        {
          Chk_Date: "false",
          ID: -1,
          Username: loginData.Name,
          User_ID: loginData.User_ID,
          UserRole_ID: "1",
          Client_ID: loginData.Client_ID,
          trn_referenceNo: params.trn_referenceNo ?? "",
          GCCTransactionNo: "",
          WireTransfer_ReferanceNo: params.WireTransfer_ReferanceNo ?? "",
          sender_name: "",
          Beneficiary_Name: "",
          TrnStatus: -1,
          payment_type: -1,
          payment_status: -1,
          Branch_ID1: -1,
          Branch_ID: -1,
          CountryId: -1,
          collection_type: -1,
          delivery_type: -1,
          user_id_new: -1,
          search_activity: "1",
          From_View_Transfers: "Yes",
          fromdate: params.fromdate ?? defaultFromDate(),
          todate: params.todate ?? todayDDMMYYYY(),
          Coll_PointId: "-1",
          agent_branch: loginData.Agent_branch ?? "1",
          PinNumber: "",
          Mobile_Number: "",
          Sender_DateOfBirth: "",
        },
      ],
    }),
    credentials: "omit",
  });

  if (!res.ok) {
    throw new Error(
      `Transaction search HTTP error: ${res.status} ${res.statusText}`
    );
  }

  return res.json();
}

// ─── env validation ──────────────────────────────────────────────────────────

export function getCredentials() {
  const username = process.env.TASSAPAY_USERNAME;
  const password = process.env.TASSAPAY_PASSWORD;
  const branchKey = process.env.TASSAPAY_BRANCH_KEY;

  if (!username || !password || !branchKey) {
    throw new Error(
      "Missing env vars: TASSAPAY_USERNAME / TASSAPAY_PASSWORD / TASSAPAY_BRANCH_KEY\n" +
        "Add them to .env.local in the project root."
    );
  }

  return { username, password, branchKey };
}

// ─── convenience: chain both calls ───────────────────────────────────────────

export async function loginAndSearch(params: CustomerSearchParams = {}) {
  const { username, password, branchKey } = getCredentials();

  const { loginData, cookieHeader } = await login(username, password, branchKey);
  const customers = await searchCustomers(cookieHeader, loginData, params);

  return { customers, loginData };
}

export async function loginAndSearchTransfers(params: TransferSearchParams = {}) {
  const { username, password, branchKey } = getCredentials();

  const { loginData, cookieHeader } = await login(username, password, branchKey);
  const transfers = await searchTransfers(cookieHeader, loginData, params);

  return { transfers, loginData };
}
