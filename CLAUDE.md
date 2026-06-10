# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A standalone, single-file HTML application for filling out and managing photovoltaic (PV/solar) project information forms. All UI text is in Chinese (中文). Runs entirely in the browser — just open `光伏项目信息表单.html`.

## How to Use / Develop

- **Run the app**: Open `光伏项目信息表单.html` directly in a browser. No build step, no server, no dependencies.
- **There are no tests** — this project has no test framework. Manual verification in the browser is the only validation method.
- **There is no build/lint process** — this is vanilla HTML/CSS/JS with zero toolchain.

## Architecture

Everything is in one file (`光伏项目信息表单.html`) with three clear sections:
1. **`<style>`** (~800 lines) — Complete design system with CSS custom properties (cyan/green energy theme), responsive grid layouts, print styles for A4 PDF export
2. **`<body>`** — Semantic HTML form with 8 sections: Project Basic Info → Energy Assessment → Module Selection → Inverter Selection → Bracket Selection → Cable Selection → Auxiliary Materials → Remarks
3. **`<script>`** (~850 lines) — All application logic, zero frameworks

### Key Script Modules (in file order)

| Module | Lines (approx) | Purpose |
|---|---|---|
| `CITY_DATA` + `*_DB` arrays | ~100 | Static databases: Chinese provinces/cities, PV modules, inverters, brackets, DC/AC cables, combiners, cable trays |
| `makeInverterEntryHTML` / `makeCableEntryHTML` | ~50 each | Dynamic multi-entry card generation for inverter and cable sections |
| `collectRawData` / `restoreRawData` | ~50 | Serialize/deserialize entire form state for save/load |
| `getFormData()` | ~50 | Collect labeled form data as key-value pairs (used for PDF export display) |
| `autoCalcModules()` | ~20 | Auto-calculate module count from area + capacity + module power |
| Project CRUD | ~200 | `saveProject`, `loadProject`, `deleteProject`, `newProject`, `renderProjectList`, `updateProjectSelector` — multi-project management via `localStorage` key `pv_projects` |
| Draft save/load | ~15 | Single-form draft via `localStorage` key `pv_project_draft` |
| PDF export | ~15 | Sets print date header, updates document title, triggers `window.print()` |
| Validation | ~15 | Checks project name, province, and generation mode are filled |

### Dynamic Entry System

Inverter and cable sections support multiple entries (add/remove cards). Each entry is rendered as an `entry-card` div with auto-generated IDs like `inverterModel_0`, `inverterPower_0`, etc. Counters `inverterEntryCount` and `cableEntryCount` track the next index. Restore functions (`restoreInverterEntries`, `restoreCableEntries`) clear and rebuild all entries from saved data arrays.

### Data Flow

- **Form → save**: `collectRawData()` reads all DOM values + dynamic entries → stored as `{id, name, location, rawData, createdAt, updatedAt}` in `localStorage.pv_projects`
- **Load → form**: `loadProject(id)` finds project by `id` → `restoreRawData(project.rawData)` populates DOM including dynamic entries and cascading province→city
- **Draft**: Separate simpler path — `collectRawData()` → `localStorage.pv_project_draft` (single draft, no project metadata)
- **Print**: `getFormData()` uses `selOrCustom` to resolve select-or-custom-input fields, formats values with units for display

### Custom Select Pattern

Several dropdowns (module model, bracket model, combiner box, cable tray) support "custom" mode: selecting the last option reveals a hidden text input. Pattern: `<select onchange="onXSelect(this.value)"> ... <option value="custom">✎ 自定义...</option></select><input class="custom-input">`. The `toggleCustomInput(selectEl, inputEl)` function shows/hides the custom input based on `value === 'custom'`.

### Location Cascader

Province dropdown triggers `onProvinceChange()` which populates the city dropdown from `CITY_DATA[province]`. On restore, province is set first, then city is set after a 60ms timeout to allow the city dropdown to populate.
