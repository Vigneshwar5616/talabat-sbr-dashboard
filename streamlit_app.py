"""talabat Customer Intelligence Simulator - SBR group project (synthetic data, not affiliated with talabat)."""
import streamlit as st

st.set_page_config(page_title="talabat Customer Intelligence Simulator", layout="wide")

pages = [
    st.Page("simulator.py", title="Live simulator", icon=":material/monitoring:", default=True),
    st.Page("python_lab.py", title="Python ML lab", icon=":material/science:"),
]
st.navigation(pages).run()
