# Publicar exclusivamente na conta bahianoreida99
# Execute a partir da pasta extraída do projeto (nenhuma chave é incluída).
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$repo = 'https://github.com/bahianoreida99/Sistema-rei-da-99.git'
function GitChecked {
    & git @args
    if ($LASTEXITCODE -ne 0) { throw "Comando Git falhou ($LASTEXITCODE)." }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git for Windows não está instalado.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI não está instalado.' }
$githubOwner = (& gh api user --jq '.login' 2>$null)
if ($LASTEXITCODE -ne 0 -or $githubOwner -ne 'bahianoreida99') { throw 'Autorize gh auth login como bahianoreida99. Credenciais de outras contas não serão usadas.' }
if (-not (Test-Path './package.json') -or -not (Test-Path './app/page.tsx')) { throw 'Extraia o ZIP completo antes de publicar.' }
if (-not (Test-Path './.git')) { GitChecked init -b main }
$remoteNames = @(& git remote)
if ($remoteNames -contains 'origin') { $remote = (& git remote get-url origin) } else { $remote = $null }
if (-not $remote) { GitChecked remote add origin $repo }
elseif ($remote.Trim() -notin @($repo,'git@github.com:bahianoreida99/Sistema-rei-da-99.git')) {
    throw "Esta pasta está vinculada a outro repositório: $remote"
}
$branch = (& git branch --show-current).Trim()
if ($branch -ne 'main') { throw "A branch atual é '$branch', não main. Não alterarei branches existentes." }
GitChecked add --all
$staged = @(& git diff --cached --name-only)
if ($staged | Where-Object { $_ -ne '.env.example' -and $_ -match '(?i)(^|/)\.env(\.|$)|\.pem$|(^|/)\.git/|service[_-]?role|secrets?' }) {
    & git reset | Out-Null
    throw 'Detectei possível segredo entre os arquivos preparados. Publicação interrompida.'
}
if ($staged.Count -gt 0) {
    GitChecked -c user.name='Bahiano Rei da 99' -c user.email='bahiano.reida99uber@gmail.com' commit -m 'Publica painel e automação do Rei da 99'
} else { Write-Host 'Não há mudanças para um novo commit.' }
Write-Host "Enviando exclusivamente para $repo"
Write-Host 'Se solicitado, entre no GitHub com a conta bahianoreida99.'
GitChecked -c credential.helper= -c 'credential.helper=!gh auth git-credential' push --set-upstream origin main
Write-Host 'Publicado: https://github.com/bahianoreida99/Sistema-rei-da-99'
