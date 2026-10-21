"""Safe release metadata shared by the API and the cloud worker."""
import os


def runtime_identity():
    return {
        "deployment_id": os.getenv("VERCEL_DEPLOYMENT_ID") or None,
        "commit": os.getenv("VERCEL_GIT_COMMIT_SHA") or None,
        "environment": os.getenv("VERCEL_ENV") or None,
    }


def same_release(api, worker):
    # A redeployment of the same commit can have different configuration.
    for key in ("deployment_id", "commit"):
        if api.get(key) and worker.get(key):
            return api[key] == worker[key]
    return None
