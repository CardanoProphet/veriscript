import "dotenv/config";
import express from "express";
import cors from "cors";
import { NETWORK, getHashes, getAddresses } from "./config";
import protocolRouter from "./routes/protocol";
import attestationsRouter from "./routes/attestations";
import signersRouter from "./routes/signers";

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", network: NETWORK });
});

// Config endpoint – exposes network / script hashes to the frontend
app.get("/api/config", (_req, res) => {
  res.json({
    network: NETWORK,
    hashes: getHashes(),
    addresses: getAddresses(),
  });
});

app.use("/api/protocol-parameters", protocolRouter);
app.use("/api/attestations", attestationsRouter);
app.use("/api/signers", signersRouter);

app.listen(PORT, () => {
  console.log(
    `VeriScript backend running on port ${PORT} (network: ${NETWORK})`,
  );
});
