import time, pandas as pd, yfinance as yf
syms = open("backtest-data/symbols.txt").read().split()
tick = [s + ".NS" for s in syms] + ["^CRSLDX", "^NSEI"]
rows, prior, failed = [], [], []
CUT = pd.Timestamp("2023-06-01")
for b in range(0, len(tick), 50):
    batch = tick[b:b + 50]
    for attempt in range(3):
        try:
            d = yf.download(batch, period="max", interval="1d", auto_adjust=False, group_by="ticker", threads=True, progress=False)
            break
        except Exception as e:
            print("retry", b, e); time.sleep(10)
    for t in batch:
        try:
            g = d[t].dropna(subset=["Close"])
        except Exception:
            g = pd.DataFrame()
        if g.empty:
            failed.append(t); continue
        g.index = pd.to_datetime(g.index).tz_localize(None)
        old = g[g.index < CUT]
        prior.append((t, round(float(old.High.max()), 2) if len(old) else "", str(g.index[0].date())))
        g = g[g.index >= CUT]
        rows.append(pd.DataFrame({"date": g.index.strftime("%Y-%m-%d"), "symbol": t, "open": g.Open.round(2), "high": g.High.round(2),
                                  "low": g.Low.round(2), "close": g.Close.round(2), "adj_close": g["Adj Close"].round(2), "volume": g.Volume.astype("int64")}))
    print(b, len(rows), len(failed), flush=True)
    time.sleep(2)
pd.concat(rows).to_csv("nse_prices_backtest.csv.gz", index=False)
pd.DataFrame(prior, columns=["symbol", "ath_before_2023_06", "first_date"]).to_csv("prior_ath.csv", index=False)
open("failed.txt", "w").write("\n".join(failed))
print("done", len(rows), "failed", len(failed))
