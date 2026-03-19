import { useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useListDocuments, useUploadDocument, Document } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, FileText, Loader2, AlertCircle } from "lucide-react";
import { getListDocumentsQueryKey } from "@/api-client";

export default function Documents() {
  const { businessId } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListDocuments(businessId!);
  const uploadDoc = useUploadDocument();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      try {
        await uploadDoc.mutateAsync({ businessId: businessId!, data: { file } });
        toast({ title: "Upload Started", description: `${file.name} is being processed.` });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Upload failed";
        toast({ title: "Upload Failed", description: message, variant: "destructive" });
      }
    }
    queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(businessId!) });
  }, [businessId, uploadDoc, queryClient, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/plain': ['.txt'],
      'text/csv': ['.csv']
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Knowledge Base</h1>
        <p className="text-muted-foreground mt-1">Upload documents to power your AI Assistant's memory (RAG).</p>
      </div>

      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer 
          ${isDragActive ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-card/50 hover:border-primary/50 hover:bg-card/80'}`}
      >
        <input {...getInputProps()} />
        <UploadCloud className={`w-16 h-16 mx-auto mb-4 transition-colors ${isDragActive ? 'text-primary' : 'text-muted-foreground'}`} />
        <h3 className="text-xl font-bold mb-2">Drag & Drop Documents</h3>
        <p className="text-muted-foreground">Supports PDF, DOCX, TXT, and CSV up to 10MB</p>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-xl overflow-hidden shadow-xl shadow-black/5">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead>Filename</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Chunks</TableHead>
              <TableHead>Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="h-24 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary"/></TableCell></TableRow>
            ) : !data?.items.length ? (
              <TableRow><TableCell colSpan={4} className="h-48 text-center text-muted-foreground">No documents uploaded yet.</TableCell></TableRow>
            ) : (
              data.items.map((doc: Document) => (
                <TableRow key={doc.id} className="border-border/50">
                  <TableCell className="font-medium flex items-center gap-3">
                    <FileText className="w-4 h-4 text-primary" />
                    {doc.filename}
                  </TableCell>
                  <TableCell>
                    {doc.status === 'ready' && <Badge className="bg-emerald-500/10 text-emerald-500">Ready</Badge>}
                    {doc.status === 'processing' && <Badge variant="secondary" className="bg-blue-500/10 text-blue-500"><Loader2 className="w-3 h-3 mr-1 animate-spin inline"/> Processing</Badge>}
                    {doc.status === 'error' && (
                      <Badge variant="destructive" title={doc.error_message || ''}>
                        <AlertCircle className="w-3 h-3 mr-1 inline"/> Error
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{doc.chunk_count || '-'}</TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(doc.uploaded_at), 'MMM d, yyyy')}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
