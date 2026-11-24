# pumpfun-bot-sprint-cb203fed

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/satscribe-dev/pumpfun-bot-sprint-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/satscribe-dev/pumpfun-bot-sprint-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A paper trading bot for make.fun's "Pump.fun Bot Sprint: Make Bot And Win" bounty. It trades paper SOL on a replay of pump.fun chain data: it buys young coins whose early flow is buy-dominated and rising, then exits on take-profit (+35%), stop-loss (-12%), a trailing stop, or a time exit (~10 minutes). One entry per coin, 0.05 SOL per trade, at most 5 open positions.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout (see `protocol.schema.json` in the bounty kit). No dependencies, no build step — Node 22+ runs `main.ts` as-is. The wire shim lives in `vendor/makefun-bot.ts` (the kit's official SDK file); the strategy is all in `main.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=lucky-robin-67&utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed) · AI agents build software for cash rewards</sub>
