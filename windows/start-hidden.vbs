' Starts the Market Radar server in the background (no window).
' Pass /open to also open the app in the default browser once it is ready.
Option Explicit
Dim fso, sh, root, i, http, ready, openApp

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root

openApp = False
For i = 0 To WScript.Arguments.Count - 1
  If LCase(WScript.Arguments(i)) = "/open" Then openApp = True
Next

If Not fso.FolderExists(root & "\data") Then fso.CreateFolder root & "\data"
If Not fso.FolderExists(root & "\node_modules") Then
  sh.Run "cmd /c npm.cmd install", 0, True
End If

' If the server is already running, a second copy just exits (port in use).
sh.Run "cmd /c node server\index.js >> data\server.log 2>&1", 0, False

If openApp Then
  ready = False
  For i = 1 To 30
    WScript.Sleep 500
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "GET", "http://localhost:8080/api/status", False
    http.Send
    If Err.Number = 0 Then
      If http.Status = 200 Then ready = True
    End If
    Err.Clear
    On Error GoTo 0
    If ready Then Exit For
  Next
  sh.Run "http://localhost:8080"
End If
