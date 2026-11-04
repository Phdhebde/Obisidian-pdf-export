// Validates .docx files against the Office Open XML schemas, as Word reads
// them, and exits with 1 if any has an error — the kind that makes Word say
// it "found unreadable content".
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length == 0)
{
    Console.Error.WriteLine("Usage: OoxmlValidate <file.docx>...");
    return 2;
}

var validator = new OpenXmlValidator(FileFormatVersions.Microsoft365);
var failed = 0;
foreach (var path in args)
{
    try
    {
        using var doc = WordprocessingDocument.Open(path, false);
        var errors = validator.Validate(doc).ToList();
        if (errors.Count == 0)
        {
            Console.WriteLine($"ok    {path}");
            continue;
        }
        failed++;
        Console.WriteLine($"FAIL  {path}: {errors.Count} error(s)");
        foreach (var e in errors.Take(50))
            Console.WriteLine($"  {e.Part?.Uri} {e.Path?.XPath}\n    {e.Description}");
    }
    catch (Exception e)
    {
        failed++;
        Console.WriteLine($"FAIL  {path}: {e.Message}");
    }
}
return failed == 0 ? 0 : 1;
