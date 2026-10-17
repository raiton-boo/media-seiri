-- ライブラリの置き場(exFAT など)は、大文字小文字を区別しない。名前の衝突の確認を、速くするため、
-- 区別しない一意の索引を足す。NOCASE は、ASCII の文字だけが対象(それ以外の文字は、実在の確認で補う)。
CREATE UNIQUE INDEX library_files_rel_path_nocase ON library_files (rel_path COLLATE NOCASE);
