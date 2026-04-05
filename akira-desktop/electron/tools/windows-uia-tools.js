/**
 * Windows UI Automation Tools
 * windows_uia - Access Windows UI Automation for window/element control
 */

const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

const IS_WINDOWS = process.platform === 'win32';
const MAX_WINDOWS = 50;
const MAX_TREE_DEPTH_DEFAULT = 12;
const MAX_TREE_NODES_DEFAULT = 200;
const MAX_NAME_LEN = 200;

/**
 * Truncate string to max length
 */
function truncate(s, n = MAX_NAME_LEN) {
  if (!s) return '';
  const str = String(s).replace(/\x00/g, '');
  if (str.length <= n) return str;
  return str.substring(0, n - 3) + '...';
}

/**
 * Execute PowerShell command
 */
async function runPowerShell(script, timeout = 30000) {
  if (!IS_WINDOWS) {
    throw new Error('windows_uia is only available on Windows');
  }

  const { stdout, stderr } = await execPromise(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout, maxBuffer: 10 * 1024 * 1024 }
  );

  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * List top-level windows using UI Automation
 */
async function listWindows() {
  const script = `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window
    )

    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)

    $results = @()
    $count = 0
    foreach ($w in $windows) {
      if ($count -ge ${MAX_WINDOWS}) { break }
      try {
        $name = $w.Current.Name
        $handle = $w.Current.NativeWindowHandle
        $className = $w.Current.ClassName
        $processId = $w.Current.ProcessId

        if ($handle -eq 0) { continue }

        $results += [PSCustomObject]@{
          title = $name
          handle = $handle
          class_name = $className
          process_id = $processId
        }
        $count++
      } catch {}
    }

    ConvertTo-Json -InputObject $results -Compress
  `;

  const { stdout } = await runPowerShell(script);
  let windows = [];
  try {
    windows = JSON.parse(stdout || '[]');
  } catch {
    windows = [];
  }

  return {
    windows: windows.map(w => ({
      title: truncate(w.title),
      handle: w.handle,
      class_name: truncate(w.class_name),
      process_id: w.process_id,
    })),
    count: windows.length,
  };
}

/**
 * Get element tree for a window
 */
async function getElementTree(input) {
  const handle = input.handle;
  const titleRe = input.title_re;
  const pid = input.pid;
  const processName = input.process_name;
  const maxDepth = Math.min(input.max_depth || MAX_TREE_DEPTH_DEFAULT, 24);
  const maxNodes = Math.min(input.max_nodes || MAX_TREE_NODES_DEFAULT, 500);
  const rootAutomationId = input.root_automation_id;
  const rootName = input.root_name;

  let windowSelector = '';
  if (handle) {
    windowSelector = `
      $hwnd = [IntPtr]::new(${handle})
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    `;
  } else if (pid) {
    windowSelector = `
      $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid}
      )
      $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Children, $condition
      )
    `;
  } else if (titleRe) {
    windowSelector = `
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Window
        ))
      $window = $null
      foreach ($w in $allWindows) {
        if ($w.Current.Name -match '${titleRe.replace(/'/g, "''")}') {
          $window = $w
          break
        }
      }
    `;
  } else if (processName) {
    windowSelector = `
      $procs = Get-Process -Name '${processName.replace('.exe', '').replace(/'/g, "''")}' -ErrorAction SilentlyContinue
      if ($procs) {
        $condition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procs[0].Id
        )
        $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
          [System.Windows.Automation.TreeScope]::Children, $condition
        )
      }
    `;
  } else {
    return { error: 'Provide one of: handle, pid, process_name, or title_re.' };
  }

  const script = `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    ${windowSelector}

    if ($window -eq $null) {
      Write-Output '{"error":"Window not found"}'
      exit
    }

    $global:nodeCount = 0
    $maxNodes = ${maxNodes}
    $maxDepth = ${maxDepth}

    function Get-ElementTree {
      param($element, $depth)

      if ($global:nodeCount -ge $maxNodes) { return $null }
      if ($depth -gt $maxDepth) { return $null }

      $global:nodeCount++

      try {
        $rect = $element.Current.BoundingRectangle
        $node = @{
          control_type = $element.Current.ControlType.ProgrammaticName -replace 'ControlType\\.',''
          name = $element.Current.Name
          automation_id = $element.Current.AutomationId
          class_name = $element.Current.ClassName
          bounds = @{
            left = [int]$rect.Left
            top = [int]$rect.Top
            right = [int]$rect.Right
            bottom = [int]$rect.Bottom
          }
          is_enabled = $element.Current.IsEnabled
          has_keyboard_focus = $element.Current.HasKeyboardFocus
        }

        if ($depth -lt $maxDepth -and $global:nodeCount -lt $maxNodes) {
          $children = @()
          try {
            $childElements = $element.FindAll([System.Windows.Automation.TreeScope]::Children,
              [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($child in $childElements) {
              if ($global:nodeCount -ge $maxNodes) { break }
              $childNode = Get-ElementTree -element $child -depth ($depth + 1)
              if ($childNode) { $children += $childNode }
            }
          } catch {}

          if ($children.Count -gt 0) {
            $node.children = $children
          }
        }

        return $node
      } catch {
        return $null
      }
    }

    $startElement = $window
    ${rootAutomationId ? `
    try {
      $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${rootAutomationId}'
      )
      $found = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if ($found) { $startElement = $found }
    } catch {}
    ` : ''}
    ${rootName ? `
    try {
      $allDesc = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($d in $allDesc) {
        if ($d.Current.Name -like '*${rootName}*') {
          $startElement = $d
          break
        }
      }
    } catch {}
    ` : ''}

    $tree = Get-ElementTree -element $startElement -depth 0

    $result = @{
      tree = $tree
      nodes_serialized = $global:nodeCount
      truncated = ($global:nodeCount -ge $maxNodes)
    }

    ConvertTo-Json -InputObject $result -Depth 20 -Compress
  `;

  const { stdout } = await runPowerShell(script, 60000);
  let result = {};
  try {
    result = JSON.parse(stdout || '{}');
  } catch {
    result = { error: 'Failed to parse tree' };
  }

  if (result.error) {
    return result;
  }

  return {
    tree: result.tree,
    nodes_serialized: result.nodes_serialized || 0,
    truncated: result.truncated || false,
  };
}

/**
 * Invoke (click) an element
 */
async function invokeElement(input) {
  const windowSelector = buildWindowSelector(input);
  const elementSelector = buildElementSelector(input);

  const script = `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    ${windowSelector}

    if ($window -eq $null) {
      Write-Output '{"error":"Window not found"}'
      exit
    }

    ${elementSelector}

    if ($element -eq $null) {
      Write-Output '{"error":"Element not found"}'
      exit
    }

    $rect = $element.Current.BoundingRectangle
    $bounds = @{
      left = [int]$rect.Left
      top = [int]$rect.Top
      right = [int]$rect.Right
      bottom = [int]$rect.Bottom
    }

    try {
      $invokePattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invokePattern.Invoke()
      $result = @{ invoked = $true; bounds = $bounds; via = 'invoke_pattern' }
    } catch {
      try {
        # Fallback: click via mouse
        $centerX = [int](($rect.Left + $rect.Right) / 2)
        $centerY = [int](($rect.Top + $rect.Bottom) / 2)

        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($centerX, $centerY)
        Start-Sleep -Milliseconds 50

        $sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int i);'
        $t=Add-Type -MemberDefinition $sig -Name MC -Namespace W -PassThru
        $t::mouse_event(0x0002, 0, 0, 0, 0)
        $t::mouse_event(0x0004, 0, 0, 0, 0)

        $result = @{ invoked = $true; bounds = $bounds; via = 'click_input' }
      } catch {
        $result = @{ error = "invoke failed: $($_.Exception.Message)" }
      }
    }

    ConvertTo-Json -InputObject $result -Compress
  `;

  const { stdout } = await runPowerShell(script);
  return JSON.parse(stdout || '{"error":"Failed"}');
}

/**
 * Set text value on an element
 */
async function setValue(input) {
  const text = input.text;
  if (text === undefined || text === null) {
    return { error: 'set_value requires text.' };
  }

  const windowSelector = buildWindowSelector(input);
  const elementSelector = buildElementSelector(input);

  const script = `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    ${windowSelector}

    if ($window -eq $null) {
      Write-Output '{"error":"Window not found"}'
      exit
    }

    ${elementSelector}

    if ($element -eq $null) {
      Write-Output '{"error":"Element not found"}'
      exit
    }

    $textToSet = '${String(text).replace(/'/g, "''")}'

    try {
      $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $valuePattern.SetValue($textToSet)
      $result = @{ set = $true; length = $textToSet.Length }
    } catch {
      try {
        # Fallback: focus and type
        $element.SetFocus()
        Start-Sleep -Milliseconds 100

        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}')
        [System.Windows.Forms.SendKeys]::SendWait($textToSet)

        $result = @{ set = $true; length = $textToSet.Length; via = 'type_keys' }
      } catch {
        $result = @{ error = "set_value failed: $($_.Exception.Message)" }
      }
    }

    ConvertTo-Json -InputObject $result -Compress
  `;

  const { stdout } = await runPowerShell(script);
  return JSON.parse(stdout || '{"error":"Failed"}');
}

/**
 * Set focus on an element
 */
async function setFocus(input) {
  const windowSelector = buildWindowSelector(input);
  const elementSelector = buildElementSelector(input);

  const script = `
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes

    ${windowSelector}

    if ($window -eq $null) {
      Write-Output '{"error":"Window not found"}'
      exit
    }

    ${elementSelector}

    if ($element -eq $null) {
      Write-Output '{"error":"Element not found"}'
      exit
    }

    try {
      $element.SetFocus()
      $rect = $element.Current.BoundingRectangle
      $result = @{
        focused = $true
        bounds = @{
          left = [int]$rect.Left
          top = [int]$rect.Top
          right = [int]$rect.Right
          bottom = [int]$rect.Bottom
        }
      }
    } catch {
      $result = @{ error = "set_focus failed: $($_.Exception.Message)" }
    }

    ConvertTo-Json -InputObject $result -Compress
  `;

  const { stdout } = await runPowerShell(script);
  return JSON.parse(stdout || '{"error":"Failed"}');
}

/**
 * Build window selector PowerShell code
 */
function buildWindowSelector(input) {
  const { handle, pid, process_name, title_re, found_index = 0 } = input;

  if (handle) {
    return `
      $hwnd = [IntPtr]::new(${handle})
      $window = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    `;
  }

  if (pid) {
    return `
      $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid}
      )
      $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Children, $condition
      )
    `;
  }

  if (process_name) {
    return `
      $procs = Get-Process -Name '${process_name.replace('.exe', '').replace(/'/g, "''")}' -ErrorAction SilentlyContinue
      $window = $null
      if ($procs) {
        $condition = [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $procs[0].Id
        )
        $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
          [System.Windows.Automation.TreeScope]::Children, $condition
        )
      }
    `;
  }

  if (title_re) {
    return `
      $root = [System.Windows.Automation.AutomationElement]::RootElement
      $allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
          [System.Windows.Automation.ControlType]::Window
        ))
      $window = $null
      $matchIndex = 0
      foreach ($w in $allWindows) {
        if ($w.Current.Name -match '${title_re.replace(/'/g, "''")}') {
          if ($matchIndex -eq ${found_index}) {
            $window = $w
            break
          }
          $matchIndex++
        }
      }
    `;
  }

  return '$window = $null';
}

/**
 * Build element selector PowerShell code
 */
function buildElementSelector(input) {
  const { automation_id, name, name_re, control_type } = input;

  let conditions = [];

  if (automation_id) {
    conditions.push(`
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${automation_id}'
      )
    `);
  }

  if (control_type) {
    conditions.push(`
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::${control_type}
      )
    `);
  }

  let searchCode = '';

  if (automation_id && conditions.length === 1) {
    // Simple AutomationId search
    searchCode = `
      $condition = ${conditions[0]}
      $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    `;
  } else if (conditions.length > 0) {
    // Combined conditions
    searchCode = `
      $conditions = @(${conditions.join(',')})
      $andCondition = [System.Windows.Automation.AndCondition]::new($conditions)
      $element = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $andCondition)
    `;
  } else {
    // Name-based search (default)
    searchCode = `$element = $null`;
  }

  // Add name matching if specified
  if (name) {
    const nameMatch = name_re
      ? `$d.Current.Name -match '${name.replace(/'/g, "''")}'`
      : `$d.Current.Name -like '*${name.replace(/'/g, "''")}*'`;

    searchCode = `
      $allDesc = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      $element = $null
      foreach ($d in $allDesc) {
        $nameOk = ${nameMatch}
        ${automation_id ? `$aidOk = $d.Current.AutomationId -eq '${automation_id}'` : '$aidOk = $true'}
        ${control_type ? `$ctOk = $d.Current.ControlType.ProgrammaticName -eq 'ControlType.${control_type}'` : '$ctOk = $true'}
        if ($nameOk -and $aidOk -and $ctOk) {
          $element = $d
          break
        }
      }
    `;
  }

  return searchCode;
}

const definitions = [
  {
    name: 'windows_uia',
    description:
      'Windows-only UI Automation: list top-level windows, dump accessibility tree, invoke (click) elements, set text, or set focus. Prefer this over blind pixel clicks for native Win32/WPF apps.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list_windows', 'element_tree', 'invoke', 'set_value', 'set_focus'],
          description: 'UIA operation.',
        },
        handle: {
          type: 'integer',
          description: 'Native window handle (HWND) for window selection.',
        },
        title_re: {
          type: 'string',
          description: 'Regex matched against window title.',
        },
        process_name: {
          type: 'string',
          description: 'Executable name e.g. notepad.exe.',
        },
        pid: {
          type: 'integer',
          description: 'Process ID to connect.',
        },
        found_index: {
          type: 'integer',
          description: '0-based index when multiple windows match title_re (default 0).',
        },
        max_depth: {
          type: 'integer',
          description: `element_tree: max tree depth (default ${MAX_TREE_DEPTH_DEFAULT}, max 24).`,
        },
        max_nodes: {
          type: 'integer',
          description: `element_tree: max nodes (default ${MAX_TREE_NODES_DEFAULT}, max 500).`,
        },
        root_automation_id: {
          type: 'string',
          description: 'element_tree: start below element with this AutomationId.',
        },
        root_name: {
          type: 'string',
          description: 'element_tree: start below element whose name contains this.',
        },
        automation_id: {
          type: 'string',
          description: 'Target element AutomationId (invoke, set_value, set_focus).',
        },
        name: {
          type: 'string',
          description: 'Target element Name (substring match unless name_re is true).',
        },
        name_re: {
          type: 'boolean',
          description: 'If true, name is a regex.',
        },
        control_type: {
          type: 'string',
          description: 'UIA control type e.g. Button, Edit, Document.',
        },
        text: {
          type: 'string',
          description: 'set_value: text to apply.',
        },
      },
      required: ['action'],
    },
  },
];

const handlers = {
  async windows_uia(input) {
    if (!IS_WINDOWS) {
      return { success: false, error: 'windows_uia is only available on Windows' };
    }

    const action = input.action;

    try {
      switch (action) {
        case 'list_windows':
          return await listWindows();

        case 'element_tree':
          return await getElementTree(input);

        case 'invoke':
          return await invokeElement(input);

        case 'set_value':
          return await setValue(input);

        case 'set_focus':
          return await setFocus(input);

        default:
          return { error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { error: error.message };
    }
  },
};

module.exports = { definitions, handlers };
