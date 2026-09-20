# Publishing

Two things get published from a `v*` tag: the npm packages and the VS Code
extension. The npm side is already wired to GitHub secrets; the marketplace side has
two mutually exclusive authentication paths, and **a missing credential never fails a
release** — the workflow skips that step and says so.

| target | authentication | status |
| --- | --- | --- |
| `@neomermaid/core`, `@neomermaid/cli` | `NPM_TOKEN` secret (+ `--provenance`, no key needed for *verification*) | wired, needs the secret |
| VS Code Marketplace | `VSCE_PAT` secret **or** Microsoft Entra ID via OIDC (no secret) | workflow supports both, neither configured yet |

## npm

```bash
gh secret set NPM_TOKEN --repo Weidows/neomermaid
```

A token that can publish to the `@neomermaid` scope. The registry is configured by
`actions/setup-node` (`registry-url: https://registry.npmjs.org`) and passed as
`NODE_AUTH_TOKEN`; `--provenance` signs the tarball with the workflow's OIDC identity,
so consumers can verify it came from this repository's `release.yml`.

*Granular token* — npmjs.com → Access Tokens → Generate New Token → Granular, scope
`@neomermaid`, permission **Read and write**, and enable **bypass 2FA** (CI has no way
to answer an OTP prompt).

*Trusted publishing (no secret at all)* — on npmjs.com, for each package:
Settings → Trusted Publisher → GitHub Actions, repo `Weidows/neomermaid`, workflow
`release.yml`. Then the `NPM_TOKEN` guard can be dropped and CI publishes with its own
OIDC identity. `permissions: id-token: write` is already in the workflow. This is the
recommended long-term option because there is nothing to rotate or leak.

## VS Code Marketplace

**Azure DevOps global PATs retire on 2026-12-01.** Microsoft's documented replacement
is Microsoft Entra ID authentication using workload identity federation / managed
identities, which is what the `--azure-credential` flag of `vsce` uses (verified
against `@vscode/vsce` 4.0.0: `--azure-credential  Use Microsoft Entra ID for
authentication`). A PAT still works today, so both paths are supported — the workflow
prefers Entra ID when it is configured and falls back to the PAT.

### Path A — Entra ID with OIDC (recommended, no stored secret)

The Azure-Pipelines steps in the official guide translate to GitHub Actions like this:

1. **Create the identity.** In Azure: create an *App registration* (or a user-assigned
   *managed identity*) and note its **client (application) ID** and **tenant ID**.
2. **Add a federated credential** so GitHub Actions can assume it without a secret.
   Issuer: `https://token.actions.githubusercontent.com`, audience:
   `api://AzureADTokenExchange`, and a subject — pick one:
   - **stable, one credential forever**: add `environment: release` to the release job
     and use subject `repo:Weidows/neomermaid:environment:release`
   - **per release**: subject `repo:Weidows/neomermaid:ref:refs/tags/v0.1.1` (tags have
     no documented wildcard, so this has to be added per tag)
3. **Give the workflow the three values** as repository secrets:

   ```bash
   gh secret set AZURE_CLIENT_ID       --repo Weidows/neomermaid
   gh secret set AZURE_TENANT_ID       --repo Weidows/neomermaid
   gh secret set AZURE_SUBSCRIPTION_ID --repo Weidows/neomermaid
   ```

   The workflow logs in with `azure/login@v2` (which uses the `id-token: write`
   permission already granted) and then runs
   `vsce publish --packagePath packages/vscode/*.vsix --azure-credential`.
4. **Authorise the identity as a publisher member.** Retrieve its resource id once:

   ```bash
   az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
     --resource 499b84ac-1321-427f-aa17-267ca6975798
   ```

   Then on [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
   add that id as a member of the `weidows` publisher with the **Contributor** role.

### Path B — Personal Access Token (works today)

1. Azure DevOps → User settings → Personal access tokens → New Token.
   **Organization: All accessible organizations** (a specific org is the classic
   mistake) and scopes **Marketplace → Manage**.
2. Marketplace publisher must exist: [manage](https://marketplace.visualstudio.com/manage)
   → Create publisher, with **ID exactly `weidows`** (it is fixed forever and must match
   `publisher` in `packages/vscode/package.json`).
3. ```bash
   gh secret set VSCE_PAT --repo Weidows/neomermaid
   ```

The workflow passes it as `--pat "$VSCE_PAT"`.

### Optional — Open VSX

For VSCodium / Cursor users, add an Open VSX token (open-vsx.org → Settings → Access
Tokens) as `OVSX_PAT` and a publish step running `npx ovsx publish`. Not wired up yet.

## Cutting a release

```bash
# 1. versions must match the tag — the workflow verifies this before publishing
npm version 0.1.2 --workspaces --no-git-tag-version
# 2. commit, then tag and push
git commit -am "chore: release 0.1.2"
git tag -a v0.1.2 -m "NeoMermaid 0.1.2"
git push origin main --follow-tags
```

`workflow_dispatch` also exists for dry runs. Note that the tag-match check reads
`GITHUB_REF_NAME`, so a manual run must target a tag ref
(`gh workflow run release.yml --ref v0.1.2`) or it will fail that gate — that is
deliberate: publishing is versioned, never ad-hoc.
