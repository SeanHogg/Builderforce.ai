-- Spawn for Roblox Studio
--
-- Written into your Studio plugins folder by the Spawn app, and rewritten each time the
-- app starts — edit nothing here, it will be replaced. It talks ONLY to the Spawn app on
-- this computer (127.0.0.1), with a key only this computer's Spawn app knows.
--
-- What it does:
--   * In edit mode: shows whether Spawn is connected, sends Spawn a picture of the place
--     (the Explorer tree and the scripts) when Spawn asks, and applies the changes a build
--     sends back — all of one build inside ONE undo step.
--   * In a play-test: forwards errors and warnings from the Output to Spawn, so a build
--     can fix what broke.

local PORT = {{PORT}}
local TOKEN = "{{TOKEN}}"
local BASE = "http://127.0.0.1:" .. tostring(PORT)

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local LogService = game:GetService("LogService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local function call(method: string, path: string, body: any?): any?
	local ok, res = pcall(function()
		return HttpService:RequestAsync({
			Url = BASE .. path,
			Method = method,
			Headers = { ["Content-Type"] = "application/json", ["X-Spawn-Token"] = TOKEN },
			Body = if body ~= nil then HttpService:JSONEncode(body) else nil,
		})
	end)
	if not ok or not res.Success then
		return nil
	end
	if res.Body == nil or res.Body == "" then
		return {}
	end
	local decoded, data = pcall(function()
		return HttpService:JSONDecode(res.Body)
	end)
	return if decoded then data else nil
end

-- ── In a play-test: forward the Output's errors and warnings, then stop ─────────────
if RunService:IsRunning() then
	local side = if RunService:IsServer() then "server" else "client"
	local pending: { string } = {}
	LogService.MessageOut:Connect(function(message, kind)
		if kind == Enum.MessageType.MessageError or kind == Enum.MessageType.MessageWarning then
			if #pending < 50 then
				table.insert(pending, "[" .. side .. "] " .. message)
			end
		end
	end)
	task.spawn(function()
		while true do
			task.wait(2)
			if #pending > 0 then
				local lines = pending
				pending = {}
				call("POST", "/log", { lines = lines })
			end
		end
	end)
	return
end

-- ── Edit mode: the status panel ──────────────────────────────────────────────────────
local toolbar = plugin:CreateToolbar("Spawn")
local button = toolbar:CreateButton("Spawn", "Show the Spawn connection", "")
button.ClickableWhenViewportHidden = true

local widget = plugin:CreateDockWidgetPluginGui(
	"SpawnStatus",
	DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 280, 120, 220, 90)
)
widget.Title = "Spawn"
local label = Instance.new("TextLabel")
label.Size = UDim2.fromScale(1, 1)
label.BackgroundTransparency = 1
label.TextWrapped = true
label.Font = Enum.Font.GothamMedium
label.TextSize = 15
label.Parent = widget

local function paint()
	local theme = settings().Studio.Theme
	label.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainText)
end
paint()
settings().Studio.ThemeChanged:Connect(paint)
button.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

local function setStatus(text: string)
	label.Text = text
end
setStatus("Waiting for the Spawn app…")

-- ── The picture of the place a build reads ──────────────────────────────────────────
local ROOTS = {
	"Workspace", "ServerScriptService", "ServerStorage", "ReplicatedStorage", "StarterGui",
	"StarterPack", "StarterPlayer", "Lighting", "SoundService", "Teams",
}
local MAX_LINES = 1500
local MAX_SCRIPT_CHARS = 12000
local MAX_SCRIPTS_CHARS = 60000

local function pathOf(instance: Instance, root: Instance, rootName: string): string
	local parts = {}
	local node: Instance? = instance
	while node and node ~= root do
		table.insert(parts, 1, node.Name)
		node = node.Parent
	end
	table.insert(parts, 1, rootName)
	return table.concat(parts, "/")
end

local function readSource(container: LuaSourceContainer): string
	local ok, source = pcall(function()
		return ScriptEditorService:GetEditorSource(container)
	end)
	if ok and type(source) == "string" then
		return source
	end
	local okRaw, raw = pcall(function()
		return (container :: any).Source
	end)
	return if okRaw and type(raw) == "string" then raw else ""
end

local function snapshot()
	local lines: { string } = {}
	local scripts = {}
	local budget = MAX_SCRIPTS_CHARS
	local truncated = false
	for _, rootName in ipairs(ROOTS) do
		local found, root = pcall(function()
			return game:GetService(rootName)
		end)
		if found and root then
			table.insert(lines, rootName .. " [" .. root.ClassName .. "]")
			for _, item in ipairs(root:GetDescendants()) do
				if item:IsA("Terrain") or item:IsA("Camera") or item:FindFirstAncestorOfClass("Camera") then
					continue
				end
				local path = pathOf(item, root, rootName)
				if #lines < MAX_LINES then
					table.insert(lines, path .. " [" .. item.ClassName .. "]")
				else
					truncated = true
				end
				if item:IsA("LuaSourceContainer") and budget > 0 then
					local source = string.sub(readSource(item), 1, math.min(MAX_SCRIPT_CHARS, budget))
					budget -= #source
					table.insert(scripts, { path = path, kind = item.ClassName, source = source })
				end
			end
		end
	end
	if truncated then
		table.insert(lines, "… (the rest of the place is not shown)")
	end
	return { tree = table.concat(lines, "\n"), scripts = scripts, placeName = game.Name }
end

-- ── Applying a build ────────────────────────────────────────────────────────────────
local function split(path: string): { string }
	local segments = {}
	for segment in string.gmatch(path, "[^/]+") do
		table.insert(segments, segment)
	end
	return segments
end

local function parentOf(segments: { string }, create: boolean): Instance?
	local node: Instance = game:GetService(segments[1])
	for i = 2, #segments - 1 do
		local child = node:FindFirstChild(segments[i])
		if not child then
			if not create then
				return nil
			end
			child = Instance.new("Folder")
			child.Name = segments[i]
			child.Parent = node
		end
		node = child :: Instance
	end
	return node
end

local function hexColor(hex: string): Color3
	return Color3.fromHex(hex)
end

local function keypoints(list: { any }, make: (number, any) -> any)
	local points = {}
	for i, value in ipairs(list) do
		local t = if #list == 1 then 0 else (i - 1) / (#list - 1)
		table.insert(points, make(t, value))
	end
	if #list == 1 then
		table.insert(points, make(1, list[1]))
	end
	return points
end

local function toValue(value: any): any
	if type(value) ~= "table" then
		return value
	end
	if value.Vector3 then
		local v = value.Vector3
		return Vector3.new(v[1], v[2], v[3])
	elseif value.Vector2 then
		local v = value.Vector2
		return Vector2.new(v[1], v[2])
	elseif value.Color3 then
		return hexColor(value.Color3)
	elseif value.UDim2 then
		local v = value.UDim2
		return UDim2.new(v[1], v[2], v[3], v[4])
	elseif value.UDim then
		local v = value.UDim
		return UDim.new(v[1], v[2])
	elseif value.CFrame then
		local c = value.CFrame
		return CFrame.new(c[1], c[2], c[3]) * CFrame.Angles(math.rad(c[4] or 0), math.rad(c[5] or 0), math.rad(c[6] or 0))
	elseif value.Enum then
		local enumName, item = string.match(value.Enum, "^(%w+)%.(%w+)$")
		return (Enum :: any)[enumName][item]
	elseif value.NumberRange then
		local v = value.NumberRange
		return NumberRange.new(v[1], v[2])
	elseif value.ColorSequence then
		return ColorSequence.new(keypoints(value.ColorSequence, function(t, hex)
			return ColorSequenceKeypoint.new(t, hexColor(hex))
		end))
	elseif value.NumberSequence then
		return NumberSequence.new(keypoints(value.NumberSequence, function(t, n)
			return NumberSequenceKeypoint.new(t, n)
		end))
	end
	error("a value Spawn does not know how to apply")
end

local function applyOp(op: any): { string }
	local segments = split(op.path)
	local name = segments[#segments]
	local warnings = {}

	if op.op == "delete" then
		local parent = parentOf(segments, false)
		local target = parent and parent:FindFirstChild(name)
		if target then
			target:Destroy()
		end
		return warnings
	end

	local parent = parentOf(segments, true) :: Instance
	local existing = parent:FindFirstChild(name)

	if op.op == "script" then
		if existing and existing.ClassName ~= op.kind then
			error("a " .. existing.ClassName .. " named " .. name .. " is already there")
		end
		local script = existing or Instance.new(op.kind)
		script.Name = name
		if not existing then
			script.Parent = parent
		end
		local updated = pcall(function()
			ScriptEditorService:UpdateSourceAsync(script, function()
				return op.source
			end)
		end)
		if not updated then
			(script :: any).Source = op.source
		end
		return warnings
	end

	if existing and existing.ClassName ~= op.className then
		error("a " .. existing.ClassName .. " named " .. name .. " is already there")
	end
	local instance = existing or Instance.new(op.className)
	instance.Name = name
	for property, raw in pairs(op.properties or {}) do
		local ok, err = pcall(function()
			(instance :: any)[property] = toValue(raw)
		end)
		if not ok then
			table.insert(warnings, property .. ": " .. tostring(err))
		end
	end
	if not existing then
		instance.Parent = parent
	end
	return warnings
end

local function runJob(job: any)
	local recording = ChangeHistoryService:TryBeginRecording("Spawn build")
	local applied = 0
	local failed = {}
	for index, op in ipairs(job.ops or {}) do
		local ok, result = pcall(applyOp, op)
		if ok then
			applied += 1
			for _, warning in ipairs(result) do
				table.insert(failed, { index = index - 1, error = warning, partial = true })
			end
		else
			table.insert(failed, { index = index - 1, error = tostring(result) })
		end
	end
	if recording then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)
	end
	call("POST", "/result", { jobId = job.id, applied = applied, failed = failed })
end

-- ── The loop: long-poll the app, answer what it asks ────────────────────────────────
local running = true
plugin.Unloading:Connect(function()
	running = false
end)

task.spawn(function()
	while running do
		local reply = call("GET", "/poll")
		if reply == nil then
			setStatus("Open the Spawn app to start building.")
			task.wait(3)
		else
			setStatus("Connected to Spawn ✓\n" .. game.Name)
			if reply.wantSnapshot then
				call("POST", "/snapshot", snapshot())
			end
			for _, job in ipairs(reply.jobs or {}) do
				setStatus("Building…")
				runJob(job)
				setStatus("Connected to Spawn ✓\n" .. game.Name)
			end
		end
	end
end)
