/**
 * Desktop Diagnose Tool
 * desktop_diagnose - Diagnostic tool to check if desktop automation is working
 */

const { IS_WINDOWS, runPowerShell } = require('../utils/powershell');

const definitions = [
  {
    name: 'desktop_diagnose',
    description: 'Diagnostic tool to check if desktop automation is working. Run this first if screenshot or mouse control is failing. Returns system info and capability tests.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

const handlers = {
  async desktop_diagnose() {
    const results = {
      platform: process.platform,
      isWindows: IS_WINDOWS,
      checks: {},
      recommendations: []
    };

    if (!IS_WINDOWS) {
      results.checks.platform = { status: 'error', message: 'Desktop automation requires Windows' };
      return results;
    }

    // Check 1: Can we execute PowerShell?
    try {
      const { stdout } = await runPowerShell('Write-Output "PowerShell OK"');
      results.checks.powershell = { status: 'ok', message: stdout };
    } catch (error) {
      results.checks.powershell = { status: 'error', message: error.message };
      results.recommendations.push('PowerShell execution failed. Check execution policy.');
    }

    // Check 2: Can we load System.Windows.Forms?
    try {
      const { stdout } = await runPowerShell(`
        Add-Type -AssemblyName System.Windows.Forms
        Write-Output "Forms assembly loaded"
      `);
      results.checks.windowsForms = { status: 'ok', message: stdout };
    } catch (error) {
      results.checks.windowsForms = { status: 'error', message: error.message };
      results.recommendations.push('System.Windows.Forms assembly failed to load.');
    }

    // Check 3: Can we get screen bounds?
    try {
      const { stdout } = await runPowerShell(`
        Add-Type -AssemblyName System.Windows.Forms
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        Write-Output "$($screen.Bounds.Width)x$($screen.Bounds.Height)"
      `);
      const match = stdout.match(/(\d+)x(\d+)/);
      if (match && parseInt(match[1]) > 0 && parseInt(match[2]) > 0) {
        results.checks.screenSize = { status: 'ok', message: `Screen: ${stdout}` };
      } else {
        results.checks.screenSize = { status: 'warning', message: `Unexpected output: ${stdout}` };
        results.recommendations.push('Screen size detection returned unexpected value. May be running without GUI.');
      }
    } catch (error) {
      results.checks.screenSize = { status: 'error', message: error.message };
      results.recommendations.push('Cannot access screen information. Likely running in non-interactive session.');
    }

    // Check 4: Can we access mouse position?
    try {
      const { stdout } = await runPowerShell(`
        Add-Type -AssemblyName System.Windows.Forms
        $pos = [System.Windows.Forms.Cursor]::Position
        Write-Output "$($pos.X),$($pos.Y)"
      `);
      const parts = stdout.split(',');
      if (parts.length === 2 && !isNaN(parseInt(parts[0]))) {
        results.checks.mousePosition = { status: 'ok', message: `Mouse at: ${stdout}` };
      } else {
        results.checks.mousePosition = { status: 'warning', message: `Unexpected output: ${stdout}` };
      }
    } catch (error) {
      results.checks.mousePosition = { status: 'error', message: error.message };
      results.recommendations.push('Cannot read mouse position.');
    }

    // Check 5: Can we load System.Drawing for screenshots?
    try {
      const { stdout } = await runPowerShell(`
        Add-Type -AssemblyName System.Drawing
        Write-Output "Drawing assembly loaded"
      `);
      results.checks.systemDrawing = { status: 'ok', message: stdout };
    } catch (error) {
      results.checks.systemDrawing = { status: 'error', message: error.message };
      results.recommendations.push('System.Drawing assembly failed to load. Screenshots may not work.');
    }

    // Check 6: Can we use user32.dll for input simulation?
    try {
      const { stdout } = await runPowerShell(`
        $sig='[DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);'
        $t=Add-Type -MemberDefinition $sig -Name User32Test -Namespace Win32 -PassThru
        $width = $t::GetSystemMetrics(0)
        $height = $t::GetSystemMetrics(1)
        Write-Output "$width,$height"
      `);
      const parts = stdout.split(',');
      if (parts.length === 2 && parseInt(parts[0]) > 0) {
        results.checks.user32 = { status: 'ok', message: `user32.dll working. Screen: ${stdout}` };
      } else {
        results.checks.user32 = { status: 'warning', message: `GetSystemMetrics returned: ${stdout}` };
      }
    } catch (error) {
      results.checks.user32 = { status: 'error', message: error.message };
      results.recommendations.push('user32.dll access failed. Mouse/keyboard control may not work.');
    }

    // Summary
    const allChecks = Object.values(results.checks);
    const errors = allChecks.filter(c => c.status === 'error').length;
    const warnings = allChecks.filter(c => c.status === 'warning').length;

    if (errors === 0 && warnings === 0) {
      results.summary = 'All checks passed. Desktop automation should work correctly.';
    } else if (errors > 0) {
      results.summary = `${errors} error(s) detected. Desktop automation may not work. Check recommendations.`;
    } else {
      results.summary = `${warnings} warning(s) detected. Some features may not work correctly.`;
    }

    return results;
  },
};

module.exports = { definitions, handlers };
