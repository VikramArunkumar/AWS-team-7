# Offline authorization audit for template.yaml.
#
# Translates the SAM template with aws-sam-translator (no AWS calls, no
# credentials) and fails if any non-OPTIONS method lacks the Cognito
# authorizer with the carebridge/access scope, or if a CORS preflight is
# protected. Run from backend/:
#
#   uv run --no-project --with aws-sam-translator --with pyyaml \
#     python scripts/check-template-auth.py
#
# This checks the generated configuration only. It does not prove the
# deployed authorizer works; use the deployed smoke test in README.md.
import json
import os
import sys

# The translator only needs a region to fill pseudo-parameters; no AWS calls are made.
os.environ.setdefault("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "us-east-1"))

from samtranslator.translator.transform import transform  # noqa: E402
from samtranslator.yaml_helper import yaml_parse


class NoopPolicyLoader:
    def load(self):
        return {}


with open("template.yaml") as f:
    template = yaml_parse(f.read())

# `sam package` would replace local CodeUri values with S3 locations.
for res in template["Resources"].values():
    if res["Type"] == "AWS::Serverless::Function":
        res["Properties"]["CodeUri"] = "s3://placeholder-bucket/code.zip"

out = transform(template, {"CognitoDomainPrefix": "example-prefix"}, NoopPolicyLoader())
resources = out["Resources"]

api = resources["CareBridgeApi"]["Properties"]
body = api["Body"]
print("OpenAPI version:", body.get("openapi") or body.get("swagger"))

schemes = body.get("components", {}).get("securitySchemes", {})
for name, scheme in schemes.items():
    print("securityScheme", name, json.dumps({
        "type": scheme.get("type"),
        "authtype": scheme.get("x-amazon-apigateway-authtype"),
        "header": scheme.get("name"),
        "authorizerType": scheme.get("x-amazon-apigateway-authorizer", {}).get("type"),
    }))

problems = []
for path, methods in sorted(body["paths"].items()):
    for method, op in sorted(methods.items()):
        sec = op.get("security")
        print(f"{method.upper():8} {path:70} security={json.dumps(sec)}")
        if method == "options":
            if sec not in (None, [], [{"NONE": []}]):
                problems.append(f"OPTIONS {path} is protected")
        else:
            if sec != [{"CognitoAuthorizer": ["carebridge/access"]}]:
                problems.append(f"{method.upper()} {path} missing required scope")

preflight = body["paths"]["/me"]["options"]["x-amazon-apigateway-integration"]["responses"]["default"]
print("preflight /me headers:", json.dumps(preflight.get("responseParameters"), default=str))
print("gateway responses:", json.dumps(body.get("x-amazon-apigateway-gateway-responses"), default=str))

stages = [k for k, v in resources.items() if v["Type"] == "AWS::ApiGateway::Stage"]
print("stages:", [(k, resources[k]["Properties"]["StageName"]) for k in stages])

print("PROBLEMS:", problems or "none")
sys.exit(1 if problems else 0)
