"""Symbol lists for each asset bucket."""
from typing import List, Dict, Tuple

CRYPTO_SYMBOLS: List[Tuple[str, str]] = [
    ("BTC/USDT", "Bitcoin"), ("ETH/USDT", "Ethereum"), ("BNB/USDT", "BNB"),
    ("XRP/USDT", "XRP"), ("SOL/USDT", "Solana"), ("ADA/USDT", "Cardano"),
    ("DOGE/USDT", "Dogecoin"), ("TRX/USDT", "TRON"), ("AVAX/USDT", "Avalanche"),
    ("LINK/USDT", "Chainlink"), ("DOT/USDT", "Polkadot"), ("MATIC/USDT", "Polygon"),
    ("LTC/USDT", "Litecoin"), ("SHIB/USDT", "Shiba Inu"), ("BCH/USDT", "Bitcoin Cash"),
    ("UNI/USDT", "Uniswap"), ("ATOM/USDT", "Cosmos"), ("XLM/USDT", "Stellar"),
    ("ICP/USDT", "Internet Computer"), ("ETC/USDT", "Ethereum Classic"),
    ("APT/USDT", "Aptos"), ("FIL/USDT", "Filecoin"), ("NEAR/USDT", "NEAR Protocol"),
    ("VET/USDT", "VeChain"), ("HBAR/USDT", "Hedera"), ("ARB/USDT", "Arbitrum"),
    ("OP/USDT", "Optimism"), ("MKR/USDT", "Maker"), ("GRT/USDT", "The Graph"),
    ("AAVE/USDT", "Aave"), ("INJ/USDT", "Injective"), ("IMX/USDT", "Immutable"),
    ("STX/USDT", "Stacks"), ("SAND/USDT", "The Sandbox"), ("MANA/USDT", "Decentraland"),
    ("AXS/USDT", "Axie Infinity"), ("FTM/USDT", "Fantom"), ("ALGO/USDT", "Algorand"),
    ("EOS/USDT", "EOS"), ("XTZ/USDT", "Tezos"), ("CHZ/USDT", "Chiliz"),
    ("CAKE/USDT", "PancakeSwap"), ("EGLD/USDT", "MultiversX"), ("THETA/USDT", "Theta"),
    ("ZEC/USDT", "Zcash"), ("DASH/USDT", "Dash"), ("NEO/USDT", "NEO"),
    ("KCS/USDT", "KuCoin Token"), ("WAVES/USDT", "Waves"), ("ONE/USDT", "Harmony"),
]

METALS_SYMBOLS: List[Tuple[str, str]] = [
    # Futures
    ("GC=F", "Gold Futures"),
    ("SI=F", "Silver Futures"),
    ("HG=F", "Copper Futures"),
    ("PL=F", "Platinum Futures"),
    ("PA=F", "Palladium Futures"),
    # Bullion ETFs
    ("GLD", "SPDR Gold ETF"),
    ("IAU", "iShares Gold ETF"),
    ("SGOL", "abrdn Gold ETF"),
    ("SLV", "iShares Silver ETF"),
    ("SIVR", "abrdn Silver ETF"),
    ("PPLT", "abrdn Platinum ETF"),
    ("PALL", "abrdn Palladium ETF"),
    ("CPER", "US Copper Index ETF"),
    # Miner ETFs
    ("GDX", "Gold Miners ETF"),
    ("GDXJ", "Junior Gold Miners ETF"),
    ("SIL", "Silver Miners ETF"),
    ("SILJ", "Junior Silver Miners ETF"),
    ("COPX", "Global X Copper Miners ETF"),
    ("RING", "iShares Gold Miners ETF"),
]

STOCKS_SYMBOLS: List[Tuple[str, str]] = [
    ("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"), ("GOOGL", "Alphabet"),
    ("AMZN", "Amazon"), ("META", "Meta"), ("BRK-B", "Berkshire Hathaway"),
    ("TSLA", "Tesla"), ("LLY", "Eli Lilly"), ("V", "Visa"), ("JPM", "JPMorgan Chase"),
    ("UNH", "UnitedHealth"), ("XOM", "ExxonMobil"), ("WMT", "Walmart"), ("MA", "Mastercard"),
    ("JNJ", "Johnson & Johnson"), ("PG", "Procter & Gamble"), ("HD", "Home Depot"),
    ("AVGO", "Broadcom"), ("ABBV", "AbbVie"), ("MRK", "Merck"), ("CVX", "Chevron"),
    ("KO", "Coca-Cola"), ("PEP", "PepsiCo"), ("COST", "Costco"), ("ADBE", "Adobe"),
    ("NFLX", "Netflix"), ("CRM", "Salesforce"), ("AMD", "AMD"), ("TMO", "Thermo Fisher"),
    ("ACN", "Accenture"), ("MCD", "McDonald's"), ("BAC", "Bank of America"),
    ("ABT", "Abbott Labs"), ("ORCL", "Oracle"), ("GE", "GE"), ("NEE", "NextEra Energy"),
    ("PM", "Philip Morris"), ("TXN", "Texas Instruments"), ("QCOM", "Qualcomm"),
    ("INTC", "Intel"), ("IBM", "IBM"), ("GS", "Goldman Sachs"), ("MS", "Morgan Stanley"),
    ("BLK", "BlackRock"), ("AXP", "American Express"), ("SPGI", "S&P Global"),
    ("CAT", "Caterpillar"), ("RTX", "RTX Corp"), ("DE", "Deere"),
]

COMMODITIES_SYMBOLS: List[Tuple[str, str]] = [
    # Energy futures
    ("CL=F", "Crude Oil WTI"), ("BZ=F", "Brent Crude"), ("NG=F", "Natural Gas"),
    ("RB=F", "RBOB Gasoline"), ("HO=F", "Heating Oil"),
    # Grain futures
    ("ZC=F", "Corn"), ("ZW=F", "Wheat"), ("ZS=F", "Soybeans"),
    ("ZM=F", "Soybean Meal"), ("ZL=F", "Soybean Oil"), ("ZO=F", "Oats"),
    ("ZR=F", "Rough Rice"),
    # Soft futures
    ("KC=F", "Coffee"), ("CC=F", "Cocoa"), ("CT=F", "Cotton"),
    ("SB=F", "Sugar"), ("OJ=F", "Orange Juice"), ("LBS=F", "Lumber"),
    # Livestock futures
    ("LE=F", "Live Cattle"), ("GF=F", "Feeder Cattle"), ("HE=F", "Lean Hogs"),
    # ETFs
    ("USO", "United States Oil ETF"), ("BNO", "Brent Oil ETF"),
    ("UNG", "United States Nat Gas ETF"), ("UGA", "US Gasoline ETF"),
    ("CORN", "Teucrium Corn ETF"), ("WEAT", "Teucrium Wheat ETF"),
    ("SOYB", "Teucrium Soybean ETF"), ("DBA", "Invesco Agriculture ETF"),
    ("DBC", "Invesco Commodity Index ETF"), ("GSG", "iShares S&P GSCI ETF"),
    ("PDBC", "Invesco Optimum Yield Commodity ETF"),
]

BUCKET_MAP: Dict[str, List[Tuple[str, str]]] = {
    "crypto": CRYPTO_SYMBOLS,
    "metals": METALS_SYMBOLS,
    "stocks": STOCKS_SYMBOLS,
    "commodities": COMMODITIES_SYMBOLS,
}


# Per-bucket default ceiling when no explicit limit is requested. Crypto and
# stocks draw from deep dynamic universes (Binance top-volume / S&P-class list);
# metals & commodities use the full curated lists above ("maximum"/"more").
DEFAULT_BUCKET_MAX: Dict[str, int] = {
    "crypto": 1000,
    "stocks": 500,
    "metals": len(METALS_SYMBOLS),
    "commodities": len(COMMODITIES_SYMBOLS),
}

# Absolute upper bound on per-bucket symbolLimit for a run (DoS guardrail).
MAX_SYMBOL_LIMIT = 1000


def get_symbols(bucket: str, limit: int = None) -> List[Tuple[str, str]]:
    """Return up to `limit` (symbol, name) pairs for a bucket.

    Crypto/stocks tap deep universes so backtests can scan ~1000 coins / ~500
    stocks; metals & commodities return their full curated futures+ETF lists.
    """
    n = limit if (limit and limit > 0) else DEFAULT_BUCKET_MAX.get(bucket, 50)

    if bucket == "crypto":
        # Dynamic top-N USDT pairs from Binance (cached 24h), falls back to static.
        from app.services.signals import get_crypto_symbols_for_limit
        return get_crypto_symbols_for_limit(n)
    if bucket == "stocks":
        from app.data.stock_universe import get_stock_symbols_for_limit
        return get_stock_symbols_for_limit(n)
    if bucket == "metals":
        return METALS_SYMBOLS[:n]
    if bucket == "commodities":
        return COMMODITIES_SYMBOLS[:n]

    return BUCKET_MAP.get(bucket, [])[:n]


def get_all_symbols_for_run(buckets: List[str], symbol_limit: int = None) -> List[Tuple[str, str, str]]:
    """Returns list of (symbol, name, bucket) tuples."""
    # Hard cap to protect the backend from pathological requests; 1000 still
    # honors the intended "up to ~1000 crypto / 500 stocks" scan size.
    if symbol_limit:
        symbol_limit = max(1, min(symbol_limit, MAX_SYMBOL_LIMIT))
    result = []
    for bucket in buckets:
        for sym, name in get_symbols(bucket, symbol_limit):
            result.append((sym, name, bucket))
    return result
