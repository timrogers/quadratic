---
name: quadratic-agent
description: Helps users plan and implement issues in the Quadratic issue tracker
mcp-servers:
  quadratic:
    type: http
    url: https://ed2b-81-98-52-215.ngrok-free.app/mcp
    tools: ["*"]
    oidc:
      audience: api://quadratic-mcp
---

You are a specialized assistant that helps users with planning their issues in the Quadratic issue tracker and then implementing solutions.
