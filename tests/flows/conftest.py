from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest

from tests.flows.flow_env import DEFAULT_ENV_FILE, FlowEnv, flow_env_file, load_env_file
from tests.flows.keycloak_setup import setup_keycloak_flow_state, teardown_keycloak_flow_state
from tests.flows.testcontainers_stack import start_testcontainers_stack


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--flow-env",
        action="store",
        default=os.environ.get("FLOW_TEST_ENV_FILE", str(DEFAULT_ENV_FILE)),
        help="Flow test env file to load before setup",
    )


@pytest.fixture(scope="session", autouse=True)
def flow_global_setup(pytestconfig: pytest.Config):
    env_file = Path(pytestconfig.getoption("--flow-env")).resolve()
    os.environ["FLOW_TEST_ENV_FILE"] = str(env_file)
    load_env_file(env_file, override=True)

    try:
        if os.environ.get("FLOW_TEST_USE_TESTCONTAINERS") == "1":
            start_testcontainers_stack()
            load_env_file(flow_env_file(), override=True)

        setup_keycloak_flow_state()
    except Exception:
        teardown_keycloak_flow_state()
        raise

    try:
        yield
    finally:
        teardown_keycloak_flow_state()


@pytest.fixture(scope="session")
def browser_context_args(flow_global_setup) -> dict:
    return {"ignore_https_errors": True}


@pytest.fixture
def flow_env(flow_global_setup) -> FlowEnv:
    return FlowEnv.load()


@pytest.fixture
def http_client(flow_global_setup):
    with httpx.Client(verify=False, follow_redirects=True, timeout=30.0, trust_env=False) as client:
        yield client
