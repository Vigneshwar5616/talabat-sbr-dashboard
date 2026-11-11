"""Live simulator: the full HTML/JavaScript dashboard, embedded. All models train in the visitor's browser."""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent
HTML = (ROOT / "dashboard.html").read_text(encoding="utf-8")

st.markdown(
    """<style>
    .block-container {padding-top: 1.2rem; padding-bottom: 0; padding-left: 1rem; padding-right: 1rem; max-width: 100%;}
    </style>""",
    unsafe_allow_html=True,
)

with st.sidebar:
    st.subheader("Live simulator")
    st.write(
        "Synthetic survey responses stream in while K-means, Apriori, logistic and linear regression, a decision tree, "
        "gradient boosting, XGBoost-style boosting, uplift models and A/B tests retrain in your browser."
    )
    height = st.slider("Dashboard height (pixels)", 700, 3000, 1150, 50)
    st.caption("SBR group project · synthetic data from our questionnaire · not affiliated with talabat")

components.html(HTML, height=height, scrolling=True)
