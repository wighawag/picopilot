# RPG menus + dialog reference (UI state machines, text reveal)

Structure for the menu/dialog side of an RPG or any UI-driven game (title menus,
inventory, shop, dialog boxes, turn-based battle menus). The defining problem is
NOT movement, it is a STACK of UI STATES, a cursor over a list of options, and
text that reveals over time. Get the state stack and the cursor-wrap right; the
"game feel" here is menu responsiveness and readable text pacing.

## The load-bearing rules

1. UI is a STACK of modes (`{"map"}` -> push `"menu"` -> push `"item"`). Input and
   draw dispatch on the TOP of the stack. Opening a submenu PUSHES; canceling
   (btnp 5 / X) POPS. This is cleaner than a flat `mode` string once menus nest.
2. Menu input is DISCRETE: `btnp` only. A cursor is an index into an options list;
   moving wraps with `%`. Confirm = btnp(4), cancel = btnp(5).
3. Dialog text REVEALS over time (one char every few frames), not all at once.
   Track a reveal counter; a confirm press either fast-forwards to full text or,
   if already full, advances to the next line.
4. Draw menus in SCREEN space. If the field behind is camera-offset, `camera()`
   (reset) before drawing the box, or it slides with the world.

## Mode stack + dispatch

```lua
stack={"field"}
function top() return stack[#stack] end
function push(m) add(stack,m) end
function pop() if #stack>1 then deli(stack) end end   -- never pop the base mode

function _update()
 local m=top()
 if m=="field" then
  update_field()
  if btnp(4) then push("menu") menu_cur=1 end
 elseif m=="menu" then
  update_menu()
 elseif m=="dialog" then
  update_dialog()
 end
end
```

## Cursor over a list, with wrap

```lua
menu_items=split"items,magic,status,save"   -- data as a split string
menu_cur=1

function update_menu()
 -- up/down move the cursor, wrapping (1-based, so the %+1 dance)
 if btnp(2) then menu_cur=(menu_cur-2)%#menu_items+1 end
 if btnp(3) then menu_cur=menu_cur%#menu_items+1 end
 if btnp(4) then choose(menu_items[menu_cur]) end   -- confirm
 if btnp(5) then pop() end                          -- cancel closes the menu
end

function draw_menu()
 camera()                       -- SCREEN space
 rectfill(80,8,120,40,0) rect(80,8,120,40,7)
 for i,it in ipairs(menu_items) do
  local y=12+(i-1)*7
  print(it,88,y, i==menu_cur and 7 or 5)
  if i==menu_cur then print(">",83,y,7) end
 end
end
```

## Dialog with timed text reveal

```lua
dlg={text="",shown=0}
function say(s) dlg.text=s dlg.shown=0 push("dialog") end

function update_dialog()
 if dlg.shown < #dlg.text then
  dlg.shown+=0.5                       -- ~2 chars/frame; tune for pacing
  if btnp(4) then dlg.shown=#dlg.text end  -- confirm fast-forwards to full
 else
  if btnp(4) then pop() end            -- fully shown: confirm closes/advances
 end
end

function draw_dialog()
 camera()
 rectfill(4,100,123,123,1) rect(4,100,123,123,7)
 print(sub(dlg.text,1,flr(dlg.shown)), 8,104, 7)  -- sub reveals up to `shown`
end
```

(For multi-line/word-wrapped dialog, pre-split the text into lines that fit the box
width and reveal line by line. `print` glyphs are ~4px wide, so ~28 chars per line
in a full-width box.)

## Turn-based battle menu (same primitives)

A battle is the SAME machinery: a mode on the stack (`"battle"`), a cursor over
actions (`Fight/Item/Run`), pushing a target-select submenu, then running the
action and popping back. Keep the battle STATE (hp, turn order) separate from the
MENU state (which option is highlighted); do not entangle them.

## Coroutine for scripted sequences (optional)

For a scripted intro / cutscene (text, then move a sprite, then more text), a
coroutine reads far cleaner than a hand-rolled step counter:

```lua
function intro()
 say("long ago...") yield_until_closed()
 -- move the king sprite, wait, etc.
 say("...a hero was needed.") yield_until_closed()
end
-- drive it: seq=cocreate(intro); each frame if costatus(seq)~="dead" then coresume(seq) end
```

## Genre pitfalls checklist

- [ ] UI is a STACK (push submenu / pop on cancel), dispatched on the top mode.
- [ ] Menu input is `btnp` only; cursor index WRAPS with `%` (mind 1-based).
- [ ] Dialog text reveals over time; confirm fast-forwards, then advances.
- [ ] Menus/boxes drawn in SCREEN space (`camera()` reset first).
- [ ] Battle/menu STATE kept separate from which option is highlighted.
- [ ] Word-wrap pre-computed to the box width (~28 chars full-width).
