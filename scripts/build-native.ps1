# SPDX-FileCopyrightText: 2026 Edward Nguyen
# SPDX-License-Identifier: Apache-2.0
# Builds the native OTK C++ async bridge against the locally installed Creo SDK.
#
# Usage:
#   .\scripts\build-native.ps1
#   .\scripts\build-native.ps1 -CreoInstallDir "<CREO_INSTALL_DIR>" -UseNo222
#
# Notes:
#   - otk_222.lib requires toolkit license 222 at runtime. Use -UseNo222 to link
#     otk_no222.lib instead when that license is unavailable.
#   - The link recipe mirrors PTC's own make_otk_async_examples from the SDK.

[CmdletBinding()]
param(
    [string]$CreoInstallDir = $env:CREO_INSTALL_DIR,
    [switch]$UseNo222
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$bridgeRoot = Join-Path $repoRoot 'native\otk-bridge'
$buildDir = Join-Path $bridgeRoot 'build'
$thirdParty = Join-Path $bridgeRoot 'third_party'

function Find-CreoInstallDir {
    param([string]$Hint)

    if ($Hint) {
        if (Test-Path (Join-Path $Hint 'Common Files\protoolkit\x86e_win64\obj\protoolkit_NU.lib')) {
            return (Resolve-Path $Hint).Path
        }
        throw "CREO_INSTALL_DIR '$Hint' does not look like a Creo Parametric installation."
    }

    $roots = @('C:\Program Files\PTC', 'D:\Program Files\PTC', 'D:\PTC', 'C:\PTC')
    $candidates = @()
    foreach ($root in $roots) {
        if (Test-Path $root) {
            $candidates += Get-ChildItem -Path $root -Directory -Filter 'Creo *' -ErrorAction SilentlyContinue
        }
    }
    $valid = $candidates |
        Where-Object { Test-Path (Join-Path $_.FullName 'Common Files\protoolkit\x86e_win64\obj\protoolkit_NU.lib') } |
        Sort-Object Name -Descending
    if (-not $valid) {
        throw 'No Creo Parametric installation with Pro/TOOLKIT was found. Pass -CreoInstallDir.'
    }
    return $valid[0].FullName
}

function Find-VcVars {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw 'vswhere.exe not found. Install Visual Studio 2022 with the C++ workload.'
    }
    $vsRoot = & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $vsRoot) {
        throw 'No Visual Studio installation with the C++ toolset was found.'
    }
    $vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
    if (-not (Test-Path $vcvars)) {
        throw "vcvars64.bat not found under $vsRoot"
    }
    return $vcvars
}

if (-not (Test-Path (Join-Path $thirdParty 'nlohmann\json.hpp'))) {
    throw "Vendored nlohmann/json is missing at $thirdParty\nlohmann\json.hpp"
}

$creoDir = Find-CreoInstallDir -Hint $CreoInstallDir
$vcvars = Find-VcVars

$protoolkit = Join-Path $creoDir 'Common Files\protoolkit'
$otk = Join-Path $creoDir 'Common Files\otk\otk_cpp'
$otkObj = Join-Path $otk 'x86e_win64\obj'
$protkObj = Join-Path $protoolkit 'x86e_win64\obj'

foreach ($required in @(
    (Join-Path $protoolkit 'includes'),
    (Join-Path $otk 'include'),
    (Join-Path $otkObj 'otk_cpp_async.lib'),
    (Join-Path $protkObj 'pt_asynchronous.lib'),
    (Join-Path $protkObj 'protoolkit_NU.lib'),
    (Join-Path $protkObj 'ucore.lib'),
    (Join-Path $protkObj 'udata.lib')
)) {
    if (-not (Test-Path $required)) {
        throw "Required SDK component missing: $required"
    }
}

if ($UseNo222) {
    $otkLib = 'otk_no222.lib'
    $otkLibDefine = '/DBRIDGE_OTK_LIB=\"otk_no222\"'
} else {
    $otkLib = 'otk_222.lib'
    $otkLibDefine = '/DBRIDGE_OTK_LIB=\"otk_222\"'
}
$otkLibPath = Join-Path $otkObj $otkLib
if (-not (Test-Path $otkLibPath)) {
    throw "OTK library missing: $otkLibPath"
}

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$cmd = @"
@echo off
call "$vcvars" >nul
if errorlevel 1 (echo VCVARS_FAILED & exit /b 1)
cd /d "$buildDir"
cl -nologo -c -GS -fp:precise -DPRO_USE_VAR_ARGS -DPRO_MACHINE=36 -DPRO_OS=4 -EHsc $otkLibDefine -I"$protoolkit\includes" -I"$otk\include" -I"$thirdParty" "$bridgeRoot\src\util.cxx" "$bridgeRoot\src\read.cxx" "$bridgeRoot\src\export.cxx" "$bridgeRoot\src\modeling.cxx" "$bridgeRoot\src\features.cxx" "$bridgeRoot\src\drawing.cxx" "$bridgeRoot\src\bridge.cxx" "$bridgeRoot\src\main.cxx"
if errorlevel 1 (echo COMPILE_FAILED & exit /b 1)
link -nologo /subsystem:console /out:creo-otk-bridge.exe /machine:amd64 /ignore:4049 /ignore:4219 /ignore:4217 util.obj read.obj export.obj modeling.obj features.obj drawing.obj bridge.obj main.obj "$otkLibPath" "$otkObj\otk_cpp_async.lib" "$protkObj\pt_asynchronous.lib" "$protkObj\protoolkit_NU.lib" "$protkObj\ucore.lib" "$protkObj\udata.lib" kernel32.lib user32.lib wsock32.lib advapi32.lib mpr.lib winspool.lib netapi32.lib psapi.lib gdi32.lib shell32.lib comdlg32.lib ole32.lib ws2_32.lib
if errorlevel 1 (echo LINK_FAILED & exit /b 1)
echo BUILD_OK
"@

$buildCmd = Join-Path $buildDir 'build.cmd'
Set-Content -Path $buildCmd -Value $cmd -Encoding ASCII

Write-Host "Creo SDK:    $creoDir"
Write-Host "OTK library: $otkLib"
Write-Host "Building creo-otk-bridge.exe ..."

& cmd.exe /c $buildCmd
if ($LASTEXITCODE -ne 0) {
    throw "Native build failed with exit code $LASTEXITCODE"
}

$exe = Join-Path $buildDir 'creo-otk-bridge.exe'
if (-not (Test-Path $exe)) {
    throw 'Build reported success but the executable was not produced.'
}

Write-Host "Built: $exe"
