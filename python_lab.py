"""Python ML lab: the same four algorithm families in scikit-learn / XGBoost, on the survey CSV or your own upload."""
import pandas as pd
import streamlit as st

import ml_lab as L

st.title("Python ML lab")
st.caption("Same survey, same questions, re-run in Python with scikit-learn and XGBoost. Upload real responses with the same columns to replace the synthetic data.")


@st.cache_data(show_spinner=False)
def get_data(file_bytes):
    if file_bytes is None:
        return L.load_data()
    import io
    return L.load_data(io.BytesIO(file_bytes))


with st.sidebar:
    st.subheader("Data")
    up = st.file_uploader("Upload survey CSV (same columns)", type="csv")
    try:
        df = get_data(up.getvalue() if up is not None else None)
        source = up.name if up is not None else "Synthetic seed (1,500 respondents)"
    except ValueError as err:
        st.error(f"That file can't be used: {err}. Showing the synthetic data instead.")
        df, source = get_data(None), "Synthetic seed (1,500 respondents)"
    st.write(f"Using: **{source}**")
    st.download_button("Download dataset CSV", df.to_csv(index=False).encode("utf-8"), file_name="talabat_survey.csv", mime="text/csv")
    if not L.HAS_XGB:
        st.warning("xgboost is not installed, so the XGBoost rows use scikit-learn's HistGradientBoosting instead.")

pct = lambda v: f"{v:.1%}"
tabs = st.tabs(["Data", "Clustering", "Classification", "Association rules", "Regression", "A/B test and uplift"])

with tabs[0]:
    c = st.columns(4)
    c[0].metric("Respondents", f"{len(df):,}")
    c[1].metric("Columns", len(df.columns))
    c[2].metric("Churn risk (G1 = 4–5)", pct(df["churn_risk"].mean()))
    c[3].metric("talabat mart interest (G4 = 4–5)", pct(df["mart_interested"].mean()))
    st.dataframe(df.head(50), use_container_width=True, hide_index=True)

with tabs[1]:
    st.subheader("K-means on recency, frequency and monetary value")
    k = st.select_slider("Number of clusters (k)", options=[2, 3, 4, 5], value=3)
    segment, prof, elbow, sil = L.run_kmeans(df, k)
    c = st.columns(2)
    with c[0]:
        st.caption("Orders per month vs monthly talabat spend, coloured by segment")
        plot = pd.DataFrame({"orders per month": df["orders_per_month"], "monthly spend (AED)": df["talabat_monthly_spend_aed"], "segment": segment})
        st.scatter_chart(plot, x="orders per month", y="monthly spend (AED)", color="segment", height=340)
    with c[1]:
        st.caption(f"Elbow chart · silhouette score {sil:.3f} at k = {k}")
        st.line_chart(elbow, x="k", y="inertia per customer", height=340)
    st.dataframe(prof.style.format({"days_since_order": "{:.1f}", "orders_per_month": "{:.1f}", "monthly_spend_aed": "AED {:,.0f}",
                                    "churn_risk": "{:.1%}", "mart_interest": "{:.1%}", "willing_spend_aed": "AED {:,.0f}"}), use_container_width=True)

with tabs[2]:
    task = st.radio("Target", list(L.TARGETS), format_func=lambda t: L.TARGETS[t][1], horizontal=True)
    thr = st.slider("Decision threshold", 0.1, 0.9, 0.5, 0.05)
    metrics, rocs, importance, best, _ = L.run_classifiers(df, task, thr)
    st.write(f"Best model by ROC AUC: **{best}** (test set = 25% of respondents)")
    st.dataframe(metrics.style.format("{:.3f}").highlight_max(axis=0), use_container_width=True)
    c = st.columns(2)
    with c[0]:
        st.caption("ROC curves")
        roc = pd.concat([r.assign(model=m) for m, r in rocs.items()], ignore_index=True)
        st.line_chart(roc, x="false positive rate", y="true positive rate", color="model", height=340)
    with c[1]:
        st.caption("Feature importance (boosted trees, share of total)")
        st.bar_chart(importance.head(10).rename("importance").reset_index().rename(columns={"index": "feature"}), x="feature", y="importance", horizontal=True, height=340)

with tabs[3]:
    st.subheader("Apriori on the 10 services in question F1")
    c = st.columns(3)
    ms = c[0].slider("Min support", 0.02, 0.20, 0.05, 0.01)
    mc = c[1].slider("Min confidence", 0.1, 0.9, 0.3, 0.05)
    ml = c[2].slider("Min lift", 1.0, 3.0, 1.2, 0.1)
    support, frequent, n = L.apriori(df, ms)
    r = L.rules(support, frequent, mc, ml)
    st.write(f"{len(frequent)} frequent itemsets · {len(r)} rules · {int((r['type'] == '2 → 1').sum()) if len(r) else 0} rules of the form \"if 2 services, then a 3rd\"")
    st.dataframe(r.style.format({"support": "{:.1%}", "confidence": "{:.0%}", "lift": "×{:.2f}"}), use_container_width=True, hide_index=True)

with tabs[4]:
    st.subheader("Willingness to spend per month (H4)")
    metrics, pva, coefs, importance, best, model, cols = L.run_regression(df)
    st.dataframe(metrics.style.format({"r2": "{:.3f}", "mae_aed": "AED {:,.0f}", "rmse_aed": "AED {:,.0f}"}), use_container_width=True)
    c = st.columns(2)
    with c[0]:
        st.caption(f"{best}: predicted vs actual (test set)")
        st.scatter_chart(pva, x="actual", y="predicted", height=340)
    with c[1]:
        st.caption("Linear regression coefficients (AED per +1 standard deviation)")
        st.bar_chart(coefs.head(10).rename("AED per SD").reset_index().rename(columns={"index": "feature"}), x="feature", y="AED per SD", horizontal=True, height=340)

with tabs[5]:
    st.subheader("Randomised voucher scenario (E3)")
    ab = L.ab_test(df)
    c = st.columns(4)
    c[0].metric("Control: would order", pct(ab["control"]), help=f"n = {ab['n_control']:,}")
    c[1].metric("AED 15 voucher: would order", pct(ab["voucher"]), help=f"n = {ab['n_voucher']:,}")
    c[2].metric("Uplift", f"{ab['diff'] * 100:+.1f} pts", help=f"95% CI {ab['ci_low'] * 100:+.1f} to {ab['ci_high'] * 100:+.1f} pts")
    c[3].metric("z-test p-value", f"{ab['p']:.4f}")
    st.write(f"Welch t-test on the 1–5 intent score: t = {ab['t']:.2f}, p = {ab['t_p']:.4f}. "
             + ("The voucher effect is statistically significant." if ab["p"] < 0.05 else "The voucher effect is not significant yet."))
    delta = st.slider("Uplift group cut-off (points)", 2, 25, 10, 1) / 100
    u = L.run_uplift(df, delta)
    counts = u["group"].value_counts().reindex(["Persuadable", "Sure thing", "Lost cause", "Do-not-disturb"]).fillna(0)
    c = st.columns(2)
    with c[0]:
        st.caption("Customers by uplift group (two-model XGBoost)")
        st.bar_chart(counts.rename("customers").reset_index().rename(columns={"index": "group"}), x="group", y="customers", height=320)
    with c[1]:
        st.caption("Distribution of predicted uplift")
        hist = pd.cut(u["uplift"], bins=24).value_counts().sort_index()
        st.bar_chart(pd.DataFrame({"uplift bin": [f"{b.mid * 100:+.0f}" for b in hist.index], "customers": hist.values}), x="uplift bin", y="customers", height=320)
    st.dataframe(u.sort_values("uplift", ascending=False).head(20).style.format({"p_order_with_voucher": "{:.0%}", "p_order_without": "{:.0%}", "uplift": "{:+.1%}"}),
                 use_container_width=True, hide_index=True)
