import { requireKeeperSigner, runKeeper } from "@bufi/keeper-runtime";

// Stub keeper -- real loop watches FX Bento room settlement windows
// and lands `Bento.settle` against an oracle snapshot. Until that
// lands, boot-log once and stay silent.
let bootLogged = false;

await runKeeper({
  name: "@bufi/keeper-arcade-settler",
  async tick(ctx) {
    requireKeeperSigner(ctx);
    if (!bootLogged) {
      ctx.log.info("arcade_settler.ready", {
        note: "wire FX Bento room settlement windows -> oracle snapshot -> Bento.settle",
      });
      bootLogged = true;
    }
  },
});
