import { useEffect, useState, useRef } from "react";
import {
  Upload,
  FileText,
  Trash2,
  BookOpen,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/pages/placeholder";

type Group = { id: string; name: string };

type KnowledgeDoc = {
  id: string;
  group_id: string;
  title: string;
  file_url: string | null;
  created_at: string;
};

function useGroups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("groups")
      .select("id, name")
      .order("name")
      .then(({ data }) => setGroups(data ?? []));
  }, [user]);

  return groups;
}

function useDocs(groupId: string | null) {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!groupId) {
      setDocs([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("knowledge_base")
      .select("id, group_id, title, file_url, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    setDocs((data ?? []) as KnowledgeDoc[]);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  return { docs, loading, reload: load };
}

export function KnowledgePage() {
  const groups = useGroups();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const { docs, loading, reload } = useDocs(selectedGroup);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0].id);
    }
  }, [groups, selectedGroup]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selectedGroup) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "txt", "md", "csv"].includes(ext || "")) {
      setError("Formato não suportado. Use PDF, TXT, MD ou CSV.");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("group_id", selectedGroup);
      formData.append("title", file.name);

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-knowledge`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token || ""}` },
          body: formData,
        }
      );

      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        throw new Error(
          (data.error as string) || (data.message as string) || `HTTP ${res.status}`
        );
      }

      setSuccess(`"${file.name}" processado com sucesso (${data.embedding_dimensions} dimensões).`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(doc: KnowledgeDoc) {
    setDeleting(doc.id);
    setError(null);

    try {
      if (doc.file_url) {
        const path = doc.file_url.includes("/knowledge/")
          ? doc.file_url.split("/knowledge/").pop()
          : doc.file_url;
        if (path) {
          const { data: session } = await supabase.auth.getSession();
          const token = session?.session?.access_token;
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/knowledge/${path}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token || ""}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
            }
          );
        }
      }

      const { error: dbErr } = await supabase
        .from("knowledge_base")
        .delete()
        .eq("id", doc.id);

      if (dbErr) throw dbErr;
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao deletar");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        subtitle="Upload de documentos indexados para contexto nas análises."
      />

      {/* Group selector */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <select
          value={selectedGroup ?? ""}
          onChange={(e) => {
            setSelectedGroup(e.target.value || null);
            setError(null);
            setSuccess(null);
          }}
          className="input-base h-10 rounded-xl px-3 text-sm"
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.csv"
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || !selectedGroup}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 px-4 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-xl border border-success/30 bg-success/5 px-4 py-2 text-xs text-success">
          {success}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-ink-400">Carregando documentos...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && docs.length === 0 && (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <BookOpen className="h-10 w-10 text-ink-400" />
          <p className="text-sm text-ink-300">
            Nenhum documento nesta knowledge base.
          </p>
          <p className="text-xs text-ink-400">
            Faça upload de PDFs ou arquivos de texto para enriquecer as análises.
          </p>
        </Card>
      )}

      {/* Documents list */}
      {!loading && docs.length > 0 && (
        <div className="flex flex-col gap-2">
          {docs.map((doc) => (
            <Card
              key={doc.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-5 w-5 shrink-0 text-brand-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-100">
                    {doc.title}
                  </p>
                  <p className="text-[11px] text-ink-400">
                    {new Date(doc.created_at).toLocaleDateString("pt-BR")} às{" "}
                    {new Date(doc.created_at).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(doc)}
                disabled={deleting === doc.id}
              >
                {deleting === doc.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 text-ink-400 hover:text-danger" />
                )}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
