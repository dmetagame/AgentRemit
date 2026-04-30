import {
  Indexer,
  MemData,
  type MerkleTree,
  type UploadOption,
  type Uploader,
} from "@0glabs/0g-ts-sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import type { RemittanceReceipt } from "@/types";

const RECEIPT_PREFIX = "agentremit:receipts";
const LOG_PREFIX = "agentremit:logs";
const SEED_OUTPUT_PATH = path.join(process.cwd(), "scripts", "seed-output.json");
const ZEROG_RPC = process.env.ZEROG_RPC_URL!;
const ZEROG_INDEXER = process.env.ZEROG_INDEXER_URL!;
const MIN_STORAGE_SIZE_BYTES = 256;
const DEFAULT_UPLOAD_OPTIONS: UploadOption = {
  tags: "0x",
  finalityRequired: false,
  taskSize: 10,
  expectedReplica: 1,
  skipTx: false,
  fee: BigInt(0),
};
const DEFAULT_RETRY_OPTIONS: UploadRetryOptions = {
  Retries: 10,
  Interval: 5,
  MaxGasPrice: 0,
  TooManyDataRetries: 3,
};

const GALILEO_FLOW_ABI = [
  "function submit((tuple(uint256 length, bytes tags, tuple(bytes32 root, uint256 height)[] nodes) data, address submitter) submission) payable returns (uint256 index, bytes32 digest, uint256 startIndex, uint256 length)",
  "function market() view returns (address)",
  "event Submit(address indexed sender, bytes32 indexed identity, uint256 submissionIndex, uint256 startPos, uint256 length, tuple(uint256 length, bytes tags, tuple(bytes32 root, uint256 height)[] nodes) submission)",
] as const;
const MARKET_ABI = ["function pricePerSector() view returns (uint256)"] as const;

const sessionReceiptRoots = new Map<string, string>();
const sessionReceipts = new Map<string, string>();
const sessionLogRoots = new Map<string, string>();
const sessionLogs = new Map<string, string[]>();
let seededReceiptsCache: RemittanceReceipt[] | null = null;

type ZeroGUploadResult = {
  txHash: string;
  rootHash: string;
};

type UploadRetryOptions = {
  Retries: number;
  Interval: number;
  MaxGasPrice: number;
  TooManyDataRetries?: number;
};

type SubmissionNode = {
  root: string;
  height: bigint | number | string;
};

type LegacySubmission = {
  length: bigint | number | string;
  tags: ethers.BytesLike;
  nodes: SubmissionNode[];
};

type GalileoSubmission = {
  data: LegacySubmission;
  submitter: string;
};

type SdkSubmission = NonNullable<
  Awaited<ReturnType<MemData["createSubmission"]>>[0]
>;

export type StorageSaveResult = {
  key: string;
  persistedToZeroG: boolean;
  rootHash: string | null;
  txHash: string | null;
  error: string | null;
  receipt?: RemittanceReceipt;
};

export async function saveReceipt(
  receipt: RemittanceReceipt,
): Promise<StorageSaveResult> {
  const key = getReceiptKey(receipt);
  let persistedToZeroG = false;
  let rootHash: string | null = null;
  let txHash: string | null = null;
  let storageError: string | null = null;
  const json = JSON.stringify(receipt);
  const padded = padStoragePayload(json);

  try {
    const data = new TextEncoder().encode(padded);
    const memData = new MemData(data);
    const uploadResult = await uploadToZeroG(memData);

    rootHash = uploadResult.rootHash;
    txHash = uploadResult.txHash;
    persistedToZeroG = true;
    sessionReceiptRoots.set(key, rootHash);

    console.log("[0G Storage] Saved to 0G:", rootHash);
  } catch (error) {
    console.log("[0G Storage] Fallback: saved to memory");
    storageError = errorToMessage(error);
  } finally {
    sessionReceipts.set(
      key,
      padStoragePayload(
        JSON.stringify(
          withStorageMetadata(receipt, {
            persistedToZeroG,
            rootHash,
            txHash,
            error: storageError,
          }),
        ),
      ),
    );
  }

  return {
    key,
    persistedToZeroG,
    rootHash,
    txHash,
    error: storageError,
    receipt: withStorageMetadata(receipt, {
      persistedToZeroG,
      rootHash,
      txHash,
      error: storageError,
    }),
  };
}

export async function getReceiptHistory(
  agentEnsName: string,
): Promise<RemittanceReceipt[]> {
  const prefix = getReceiptPrefix(agentEnsName);
  const receipts = new Map<string, RemittanceReceipt>();

  for (const receipt of await loadSeededReceipts()) {
    if (receipt.agentEnsName === agentEnsName) {
      receipts.set(receipt.id, receipt);
    }
  }

  Array.from(sessionReceipts.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, rawValue]) => parseReceipt(rawValue))
    .filter((receipt): receipt is RemittanceReceipt => receipt !== null)
    .forEach((receipt) => receipts.set(receipt.id, receipt));

  return Array.from(receipts.values())
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function fetchReceiptHistory(
  agentEnsName?: string,
): Promise<RemittanceReceipt[]> {
  if (!agentEnsName) {
    return [];
  }

  return getReceiptHistory(agentEnsName);
}

export async function appendToAgentLog(
  agentEnsName: string,
  entry: string,
): Promise<StorageSaveResult> {
  const timestamp = Date.now();
  const key = `${getLogPrefix(agentEnsName)}${timestamp}`;
  let result: StorageSaveResult = {
    key,
    persistedToZeroG: false,
    rootHash: null,
    txHash: null,
    error: null,
  };

  try {
    const data = new TextEncoder().encode(padStoragePayload(entry));
    const memData = new MemData(data);
    const { rootHash, txHash } = await uploadToZeroG(memData);

    sessionLogRoots.set(key, rootHash);

    console.log("[0G Storage] Saved to 0G:", rootHash);
    result = {
      key,
      persistedToZeroG: true,
      rootHash,
      txHash,
      error: null,
    };
  } catch (error) {
    console.log("[0G Storage] Fallback: saved to memory");
    result = {
      key,
      persistedToZeroG: false,
      rootHash: null,
      txHash: null,
      error: errorToMessage(error),
    };
  } finally {
    const existingLogs = sessionLogs.get(agentEnsName) ?? [];
    sessionLogs.set(agentEnsName, [entry, ...existingLogs]);
  }

  return result;
}

export async function getAgentLog(agentEnsName: string): Promise<string[]> {
  return sessionLogs.get(agentEnsName) ?? [];
}

function getReceiptKey(receipt: RemittanceReceipt): string {
  return `${getReceiptPrefix(receipt.agentEnsName)}${receipt.timestamp}`;
}

function getReceiptPrefix(agentEnsName: string): string {
  return `${RECEIPT_PREFIX}:${agentEnsName}:`;
}

function getLogPrefix(agentEnsName: string): string {
  return `${LOG_PREFIX}:${agentEnsName}:`;
}

function createZeroGStorageClient() {
  const provider = new ethers.JsonRpcProvider(ZEROG_RPC);
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
  const indexer = new Indexer(ZEROG_INDEXER);

  return {
    provider,
    indexer,
    signer,
  };
}

async function uploadToZeroG(memData: MemData): Promise<ZeroGUploadResult> {
  const { indexer, provider, signer } = createZeroGStorageClient();
  const [uploader, uploaderError] = await indexer.newUploaderFromIndexerNodes(
    ZEROG_RPC,
    signer as unknown as Parameters<
      typeof indexer.newUploaderFromIndexerNodes
    >[1],
    DEFAULT_UPLOAD_OPTIONS.expectedReplica,
  );

  if (uploaderError !== null || uploader === null) {
    throw new Error(`0G uploader init failed: ${uploaderError}`);
  }

  const [tree, treeError] = await memData.merkleTree();
  const rootHash = tree?.rootHash();

  if (treeError !== null || tree === null || !rootHash) {
    throw new Error(`0G merkle tree failed: ${treeError ?? "missing root"}`);
  }

  const [legacySubmission, submissionError] = await memData.createSubmission(
    DEFAULT_UPLOAD_OPTIONS.tags,
  );

  if (submissionError !== null || legacySubmission === null) {
    throw new Error(
      `0G submission creation failed: ${submissionError ?? "missing submission"}`,
    );
  }

  const submission = {
    data: normalizeSubmission(legacySubmission),
    submitter: signer.address,
  };
  const flowAddress = await uploader.flow.getAddress();
  const flow = new ethers.Contract(flowAddress, GALILEO_FLOW_ABI, signer);
  const fee = await calculateStorageFee(flow, submission.data);
  const txResponse = await submitGalileoFlow(flow, provider, submission, fee);
  const receipt = await txResponse.wait();

  if (receipt === null || receipt.status !== 1) {
    throw new Error(`0G submit transaction failed: ${txResponse.hash}`);
  }

  await uploadSegmentsBestEffort(
    uploader,
    memData,
    tree,
    receipt,
    DEFAULT_UPLOAD_OPTIONS,
    DEFAULT_RETRY_OPTIONS,
  );

  return {
    txHash: txResponse.hash,
    rootHash,
  };
}

function normalizeSubmission(submission: SdkSubmission): LegacySubmission {
  return {
    length: submission.length.toString(),
    tags: submission.tags,
    nodes: submission.nodes.map((node) => ({
      root: ethers.hexlify(node.root),
      height: node.height.toString(),
    })),
  };
}

async function calculateStorageFee(
  flow: ethers.Contract,
  submission: LegacySubmission,
): Promise<bigint> {
  const marketAddress = (await flow.market()) as string;
  const market = new ethers.Contract(marketAddress, MARKET_ABI, flow.runner);
  const pricePerSector = (await market.pricePerSector()) as bigint;
  const sectors = submission.nodes.reduce(
    (sum, node) => sum + (BigInt(1) << BigInt(node.height.toString())),
    BigInt(0),
  );

  return sectors * pricePerSector;
}

async function submitGalileoFlow(
  flow: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  submission: GalileoSubmission,
  fee: bigint,
) {
  const feeData = await provider.getFeeData();

  if (feeData.gasPrice === null) {
    throw new Error("0G submit failed: missing suggested gas price");
  }

  console.log("[0G Storage] Submitting transaction with storage fee:", fee);

  return flow.submit(submission, {
    value: fee,
    gasPrice: feeData.gasPrice,
  });
}

async function uploadSegmentsBestEffort(
  uploader: Uploader,
  memData: MemData,
  tree: MerkleTree,
  receipt: ethers.TransactionReceipt,
  uploadOptions: UploadOption,
  retryOptions: UploadRetryOptions,
): Promise<void> {
  try {
    const txSeqs = await uploader.processLogs(
      receipt as unknown as Parameters<Uploader["processLogs"]>[0],
    );

    if (txSeqs.length === 0) {
      console.log("[0G Storage] Warning: no 0G tx sequence found in receipt");
      return;
    }

    console.log("[0G Storage] Transaction sequence number:", txSeqs[0]);

    const info = await uploader.waitForLogEntry(txSeqs[0], false);

    if (info === null) {
      console.log("[0G Storage] Warning: log entry unavailable after submit");
      return;
    }

    const tasks = await uploader.splitTasks(info, tree, uploadOptions);

    if (tasks === null || tasks.length === 0) {
      return;
    }

    const results = await uploader.processTasksInParallel(
      memData,
      tree,
      tasks,
      retryOptions as Parameters<Uploader["processTasksInParallel"]>[3],
    );
    const warnings = results.filter(
      (result): result is Error => result instanceof Error,
    );

    if (warnings.length > 0) {
      console.log(
        "[0G Storage] Segment upload warnings:",
        warnings.map(errorToMessage).join("; "),
      );
    }
  } catch (error) {
    console.log("[0G Storage] Segment upload warning:", errorToMessage(error));
  }
}

function padStoragePayload(value: string): string {
  return value.padEnd(MIN_STORAGE_SIZE_BYTES, " ");
}

function withStorageMetadata(
  receipt: RemittanceReceipt,
  storage: {
    persistedToZeroG: boolean;
    rootHash: string | null;
    txHash: string | null;
    error: string | null;
  },
): RemittanceReceipt {
  return {
    ...receipt,
    storageProvider: storage.persistedToZeroG ? "0G" : "memory",
    zeroGRootHash: storage.rootHash ?? undefined,
    zeroGTxHash: storage.txHash ?? undefined,
    storageError: storage.error ?? undefined,
  };
}

async function loadSeededReceipts(): Promise<RemittanceReceipt[]> {
  if (seededReceiptsCache !== null) {
    return seededReceiptsCache;
  }

  try {
    const rawSeedOutput = await readFile(SEED_OUTPUT_PATH, "utf8");
    const parsed = JSON.parse(rawSeedOutput) as { receipts?: unknown };

    if (!Array.isArray(parsed.receipts)) {
      seededReceiptsCache = [];
      return seededReceiptsCache;
    }

    seededReceiptsCache = parsed.receipts
      .map((receipt) => parseReceipt(JSON.stringify(receipt)))
      .filter((receipt): receipt is RemittanceReceipt => receipt !== null);
  } catch {
    seededReceiptsCache = [];
  }

  return seededReceiptsCache;
}

function parseReceipt(rawValue: string): RemittanceReceipt | null {
  try {
    const parsed = JSON.parse(rawValue.trim()) as Partial<RemittanceReceipt>;

    if (
      typeof parsed.id === "string" &&
      typeof parsed.agentEnsName === "string" &&
      typeof parsed.senderAddress === "string" &&
      typeof parsed.recipientAddress === "string" &&
      typeof parsed.amountUsdc === "string" &&
      typeof parsed.effectiveRateNgn === "number" &&
      typeof parsed.keeperJobId === "string" &&
      typeof parsed.uniswapTxHash === "string" &&
      typeof parsed.timestamp === "number" &&
      (parsed.status === "success" || parsed.status === "failed")
    ) {
      return parsed as RemittanceReceipt;
    }
  } catch {
    return null;
  }

  return null;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
