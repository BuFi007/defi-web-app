import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

await runKeeper({
  name: "@bufi/keeper-arcade-settler",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    ctx.log.info("arcade_settler.scan", {
      note: "wire FX Bento room settlement windows -> oracle snapshot -> Bento.settle",
    });
  },
});
