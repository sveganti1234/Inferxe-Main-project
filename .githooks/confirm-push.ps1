try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $choice = [System.Windows.Forms.MessageBox]::Show(
        'Approve push to origin/development?',
        'Git push approval',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
} catch {
    [Console]::Error.WriteLine("Push blocked: unable to display approval dialog. {0}", $_.Exception.Message)
    exit 2
}

if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
    exit 0
}

exit 1
